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
  let qrImage = '';

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
    await page.getByLabel(/^Статус участника/).selectOption('KAIT_STUDENT');
    await page.getByLabel(/^Учебная группа/).fill('E2E-01');
    await page.getByLabel(/Я даю/).check();

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
    qrImage = (await page
      .getByRole('img', { name: 'QR-код билета' })
      .getAttribute('src'))!;
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
    // Feed the actual ticket image through the real QR decoder; no hidden UI bypass.
    await page.addInitScript((imageSource) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 640;
        const image = new Image();
        image.src = imageSource;
        await image.decode();
        const draw = () => {
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, 640, 640);
          ctx.drawImage(image, 80, 80, 480, 480);
        };
        draw();
        const timer = window.setInterval(draw, 100);
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0]!;
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          window.clearInterval(timer);
          originalStop();
        };
        return stream;
      };
    }, qrImage);
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

    await expect(
      page.getByText(new RegExp(participant.lastName)),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить посещение' }).click();
    await expect(
      page.getByText(/Посещение подтверждено|Участник уже был отмечен/),
    ).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Режим работы' })
      .getByRole('button', { name: 'Найти', exact: true })
      .click();
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page
      .getByRole('button', { name: 'Сканировать', exact: true })
      .click();
    await page.getByRole('button', { name: 'Подтвердить посещение' }).click();
    await expect(page.getByText('Сохранено на устройстве')).toBeVisible();
    await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();

    // R07: a cancelled confirmation must not lose the unsynced mark.
    // A page.once() listener registered before the click is required here:
    // a native confirm() blocks the page's main thread, so a click() promise
    // wrapped together with waitForEvent('dialog') in Promise.all deadlocks
    // (click() never settles until the dialog is handled, but nothing
    // handles it until Promise.all resolves).
    page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(
      page.getByRole('heading', { name: 'Демонстрационное мероприятие' }),
    ).toBeVisible();
    await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();

    // R08: a confirmed logout must not report success while the server
    // (still offline here) never actually revoked the session.
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.getByText('Выход не завершён')).toBeVisible();
    expect(dialogMessage).toContain('1 несинхронизированных');
    await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();
    await page
      .getByRole('button', { name: 'Понятно, проверить и продолжить' })
      .click();

    await page
      .getByRole('navigation', { name: 'Режим работы' })
      .getByRole('button', { name: 'Найти', exact: true })
      .click();

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

  test('organizer confirms participation, sees scoring and cancels with reversal', async ({
    page,
  }) => {
    const credentials = demoCredentials();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(credentials.adminEmail);
    await page.getByLabel('Пароль').fill(credentials.adminPassword);
    await page.getByRole('button', { name: 'Войти' }).click();
    const card = page.getByRole('article').filter({
      hasText: 'Демонстрационное мероприятие',
    });
    await card.getByRole('button', { name: 'Участники' }).click();
    await page.getByRole('button', { name: 'Участие и баллы' }).click();

    const row = page.getByRole('row').filter({ hasText: participant.lastName });
    await row.getByRole('checkbox').check();
    await page.getByLabel('Роль участия').selectOption({ label: 'Волонтёр' });
    await page.getByRole('button', { name: 'Подтвердить участие' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Участие подтверждено',
    );
    await expect(row).toContainText('20');
    await row.getByText('Почему начислено').click();
    await expect(row).toContainText('Автоматическое начисление');

    await row.getByRole('checkbox').check();
    await page
      .getByLabel('Причина изменения или подтверждения без Scanner')
      .fill('Ошибочное подтверждение в browser test');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Отменить участие' }).click();
    await expect(page.getByRole('status')).toContainText('Участие отменено');
    await expect(row).toContainText('0');
    await expect(row).toContainText('Отменено');
  });

  test('confirmation without Scanner requires a warning and an audit reason', async ({
    page,
  }) => {
    const absent = {
      email: `absent-${Date.now()}@example.com`,
      lastName: `Отсутствовал-${nonce}`,
    };
    await page.goto('/events/demo-event');
    await page.getByLabel(/^Фамилия/).fill(absent.lastName);
    await page.getByLabel(/^Имя/).fill('Участник');
    await page.getByLabel(/^Дата рождения/).fill('2006-06-10');
    await page.getByLabel(/^Email/).fill(absent.email);
    await page.getByLabel(/^Телефон/).fill(`+7988${nonce}`);
    await page.getByLabel(/^Статус участника/).selectOption('KAIT_STUDENT');
    await page.getByLabel(/^Учебная группа/).fill('E2E-02');
    await page.getByLabel(/Я даю/).check();
    await page.getByRole('button', { name: 'Получить билет' }).click();
    await expect(page.getByText('Регистрация завершена')).toBeVisible();

    const credentials = demoCredentials();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(credentials.adminEmail);
    await page.getByLabel('Пароль').fill(credentials.adminPassword);
    await page.getByRole('button', { name: 'Войти' }).click();
    const card = page.getByRole('article').filter({
      hasText: 'Демонстрационное мероприятие',
    });
    await card.getByRole('button', { name: 'Участники' }).click();
    await page.getByRole('button', { name: 'Участие и баллы' }).click();
    const row = page.getByRole('row').filter({ hasText: absent.lastName });
    await row.getByRole('checkbox').check();
    await page.getByLabel('Роль участия').selectOption({ label: 'Участник' });
    await page
      .getByLabel('Причина изменения или подтверждения без Scanner')
      .fill('Подтверждено организатором по итоговой ведомости');
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('нет отметки о входе через Scanner');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Подтвердить участие' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Участие подтверждено',
    );
    await expect(row).toContainText('10');
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

  test('constructor saves independent settings and previews hidden fields', async ({
    page,
  }, testInfo) => {
    const credentials = demoCredentials();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(credentials.adminEmail);
    await page.getByLabel('Пароль').fill(credentials.adminPassword);
    await page.getByRole('button', { name: 'Войти' }).click();
    const card = page
      .getByRole('article')
      .filter({ hasText: 'Демонстрационное мероприятие' });
    await card.getByRole('button', { name: 'Настроить' }).click();
    const constructor = page.locator('.registration-constructor');
    await expect(
      constructor.getByRole('heading', { name: 'Конструктор регистрации' }),
    ).toBeVisible();
    const phone = constructor
      .locator('.constructor-row')
      .getByLabel('Телефон', { exact: true });
    const original = await phone.inputValue();
    try {
      await phone.selectOption('HIDDEN');
      await constructor
        .getByText('Предварительный просмотр', { exact: true })
        .click();
      await expect(
        constructor.locator('details input[name="phone"]'),
      ).toHaveCount(0);
      await constructor
        .getByRole('button', { name: 'Сохранить настройки формы' })
        .click();
      await expect(constructor.getByRole('status')).toHaveText(
        'Настройки формы сохранены.',
      );
      await page.screenshot({
        path: testInfo.outputPath('constructor.png'),
        fullPage: true,
      });
      await constructor
        .getByRole('button', { name: 'На месте', exact: true })
        .click();
      await expect(phone).toHaveValue('REQUIRED');
    } finally {
      await constructor
        .getByRole('button', { name: 'На сайте', exact: true })
        .click();
      await phone.selectOption(original);
      await constructor
        .getByRole('button', { name: 'Сохранить настройки формы' })
        .click();
      await expect(constructor.getByRole('status')).toHaveText(
        'Настройки формы сохранены.',
      );
    }
  });
});
