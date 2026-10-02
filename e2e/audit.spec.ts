import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { demoCredentials } from './helpers.js';

test('chief administrator finds a change by server request ID', async ({
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
  const login = await (await loginResponse).json();
  await expect(
    page.getByRole('heading', { name: 'Мероприятия', exact: true }),
  ).toBeVisible();

  const suffix = randomUUID().slice(0, 8);
  const created = await page.request.post(
    'http://localhost:3000/admin/events',
    {
      headers: {
        Origin: 'http://localhost:5173',
        'X-CSRF-Token': login.csrfToken as string,
      },
      data: {
        title: `Тест журнала ${suffix}`,
        slug: `audit-e2e-${suffix}`,
        startAt: '2026-11-01T10:00:00+03:00',
        endAt: '2026-11-01T12:00:00+03:00',
        registrationDeadline: '2026-10-30T10:00:00+03:00',
        location: 'Тестовая площадка',
        capacity: 10,
        status: 'DRAFT',
      },
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  const requestId = created.headers()['x-request-id'];
  expect(requestId).toBeTruthy();

  await page.getByRole('button', { name: 'Журнал действий' }).click();
  await page.getByLabel('Код запроса').fill(requestId);
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(
    page.getByRole('heading', { name: 'EVENT_CREATED' }),
  ).toBeVisible();
  await expect(page.getByText(requestId, { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
