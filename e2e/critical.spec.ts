import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { demoCredentials } from './helpers.js';

test.describe.serial('critical MVP browser journey', () => {
  const nonce = String(Date.now()).slice(-7);
  const participant = {
    email: `browser-${Date.now()}@example.com`,
    firstName: 'Алексей',
    lastName: `Тестов-${nonce}`,
    phone: `+7999${nonce}`,
  };
  let qrPayload = '';

  test('public participant registers and opens a ticket', async ({ page }) => {
    await page.goto('/events/demo-event');
    await expect(
      page.getByRole('heading', { name: 'Демонстрационное мероприятие' }),
    ).toBeVisible();

    await page.getByLabel(/^Фамилия/).fill(participant.lastName);
    await page.getByLabel(/^Имя/).fill(participant.firstName);
    await page.getByLabel(/^Дата рождения/).fill('2005-05-20');
    await page.getByLabel(/^Email/).fill(participant.email);
    await page.getByLabel(/^Телефон/).fill(participant.phone);
    await page.getByLabel(/^Учебная группа/).fill('E2E-01');
    await page.getByLabel(/^Направление участия/).selectOption('Участник');
    await page.getByLabel(/Я согласен/).check();

    const registrationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/public/events/demo-event/register'),
    );
    await page.getByRole('button', { name: 'Получить билет' }).click();
    const registration = await registrationResponse;
    expect(
      registration.ok(),
      `Registration failed: ${await registration.text()}`,
    ).toBe(true);
    await expect(page.getByText('Регистрация завершена')).toBeVisible();

    const ticketResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().startsWith('http://localhost:3000/tickets/'),
    );
    await page.getByRole('link', { name: 'Открыть билет' }).click();
    const payload = (await (await ticketResponse).json()) as {
      qrPayload: string;
    };
    qrPayload = payload.qrPayload;
    expect(qrPayload).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}\.[A-Za-z0-9_-]{40,}$/,
    );
    await expect(
      page.getByRole('img', { name: 'QR-код билета' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: `${participant.lastName} ${participant.firstName}`,
      }),
    ).toBeVisible();
  });

  test('administrator sees the new participant', async ({ page }) => {
    const credentials = demoCredentials();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(credentials.adminEmail);
    await page.getByLabel('Пароль').fill(credentials.adminPassword);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(
      page.getByRole('heading', { name: 'Мероприятия' }),
    ).toBeVisible();

    const card = page.getByRole('article').filter({
      hasText: 'Демонстрационное мероприятие',
    });
    await card.getByRole('button', { name: 'Участники' }).click();
    await page.getByRole('textbox', { name: 'Поиск' }).fill(participant.email);
    await page.getByRole('button', { name: 'Найти' }).click();
    await expect(page.getByText(participant.email)).toBeVisible();
  });

  test('assigned scanner records online and preserves an offline retry', async ({
    context,
    page,
  }) => {
    const credentials = demoCredentials();
    await page.goto('http://localhost:5174');
    await page.getByLabel('Email').fill(credentials.scannerEmail);
    await page.getByLabel('Пароль').fill(credentials.scannerPassword);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(
      page.getByRole('heading', { name: 'Куда отмечаем вход?' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: /Подготовить и открыть|Открыть/ })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Демонстрационное мероприятие' }),
    ).toBeVisible();

    await page.getByText('Ввести QR вручную').click();
    await page.getByLabel('Содержимое QR').fill(qrPayload);
    await page.getByRole('button', { name: 'Проверить' }).click();
    await expect(
      page.getByText(new RegExp(participant.lastName)),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить посещение' }).click();
    await expect(
      page.getByText(/Посещение подтверждено|Участник уже был отмечен/),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.getByLabel('Содержимое QR').fill(qrPayload);
    await page.getByRole('button', { name: 'Проверить' }).click();
    await page.getByRole('button', { name: 'Подтвердить посещение' }).click();
    await expect(page.getByText('Сохранено на устройстве')).toBeVisible();
    await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: 'Куда отмечаем вход?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Открыть' }).click();
    await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText('ONLINE · синхронизировано')).toBeVisible();
    await expect(page.getByText('Данные синхронизированы')).toBeVisible();
  });

  test('public and staff entry points have no serious axe violations', async ({
    page,
  }) => {
    for (const path of ['/events/demo-event', '/admin']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.filter(({ impact }) =>
          ['critical', 'serious'].includes(impact ?? ''),
        ),
      ).toEqual([]);
    }
  });
});
