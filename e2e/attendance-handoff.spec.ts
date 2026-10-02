import { expect, test } from '@playwright/test';

import { demoCredentials } from './helpers.js';

test('administrator reviews and closes a rejected Scanner handoff', async ({
  page,
}) => {
  const credentials = demoCredentials();
  await page.goto('/admin');
  await page.getByLabel('Email').fill(credentials.adminEmail);
  await page.getByLabel('Пароль').fill(credentials.adminPassword);
  const loginResponse = page.waitForResponse((response) =>
    response.url().endsWith('/auth/login'),
  );
  await page.getByRole('button', { name: 'Войти' }).click();
  const csrfToken = (
    (await (await loginResponse).json()) as { csrfToken: string }
  ).csrfToken;
  await expect(
    page.getByRole('heading', { name: 'Мероприятия', exact: true }),
  ).toBeVisible();

  const eventId = await page.evaluate(async () => {
    const response = await fetch(
      'http://localhost:3000/admin/events?page=1&pageSize=50',
      {
        credentials: 'include',
      },
    );
    if (!response.ok) throw new Error('Could not load demo events');
    const body = (await response.json()) as {
      items: { id: string; title: string }[];
    };
    const event = body.items.find(
      (item) => item.title === 'Демонстрационное мероприятие',
    );
    if (!event) throw new Error('Demo event missing');
    return event.id;
  });
  const clientEventId = crypto.randomUUID();
  const response = await page.evaluate(
    async ({ eventId, clientEventId, csrfToken }) => {
      const result = await fetch(
        `http://localhost:3000/scanner/events/${eventId}/attendance/rejections`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            deviceId: crypto.randomUUID(),
            item: {
              clientEventId,
              registrationId: crypto.randomUUID(),
              mode: 'MANUAL_CONFIRM',
              source: 'OFFLINE_SYNC',
              deviceScannedAt: '2026-10-10T10:30:00Z',
              estimatedScannedAt: '2026-10-10T10:30:00Z',
            },
            rejectionStatus: 'INVALID_REGISTRATION',
          }),
        },
      );
      return { status: result.status, body: await result.json() };
    },
    { eventId, clientEventId, csrfToken },
  );
  expect(response.status, JSON.stringify(response.body)).toBe(201);

  const card = page
    .getByRole('article')
    .filter({ hasText: 'Демонстрационное мероприятие' });
  await card.getByRole('button', { name: 'Участники и отметки' }).click();
  const queue = page.getByRole('region', {
    name: 'Отклонённые отметки Scanner',
  });
  await expect(queue.getByText('Регистрация не найдена').first()).toBeVisible();
  await queue
    .getByLabel('Результат проверки')
    .first()
    .fill('Проверено: регистрация отсутствует');
  await queue.getByRole('button', { name: 'Завершить разбор' }).first().click();
  await expect(queue.getByText('Открытых случаев нет.')).toBeVisible();
});
