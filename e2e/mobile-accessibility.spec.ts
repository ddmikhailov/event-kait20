import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { demoCredentials } from './helpers.js';

test('registration form fits a mobile viewport and remains accessible', async ({
  page,
}) => {
  await page.goto('/events/demo-event');
  await expect(
    page.getByRole('heading', { name: 'Демонстрационное мероприятие' }),
  ).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) =>
      ['critical', 'serious'].includes(impact ?? ''),
    ),
  ).toEqual([]);

  await page.goto('/mos-active');
  await expect(
    page.getByRole('navigation', { name: 'На этой странице' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test('administrator navigation and event editor fit a narrow viewport', async ({
  page,
}) => {
  const credentials = demoCredentials();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/admin');
  await page.getByLabel('Email').fill(credentials.adminEmail);
  await page.getByLabel('Пароль').fill(credentials.adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();

  const workspaces = page.getByRole('navigation', {
    name: 'Разделы управления',
  });
  await expect(
    workspaces.getByRole('heading', { name: 'МосАктив' }),
  ).toBeVisible();
  await expect(
    workspaces.getByRole('button', { name: 'Проверить участие' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  await page
    .getByRole('article')
    .filter({ hasText: 'Демонстрационное мероприятие' })
    .getByRole('button', { name: 'Настроить' })
    .click();
  await expect(page.getByText('Уровень мероприятия')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});
