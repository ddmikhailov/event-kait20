import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

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
});
