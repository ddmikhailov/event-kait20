import { expect, test } from '@playwright/test';

const season = '10000000-0000-4000-8000-000000000002';
const previousSeason = '10000000-0000-4000-8000-000000000001';
const profileSlug = 'fictional-student';

test('MosActive retains season, search and pages while profile separates season awards from history', async ({
  page,
}) => {
  await page.route('**/public/**', async (route) => {
    const url = new URL(route.request().url());
    const respond = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (url.pathname.endsWith('/leaderboard/seasons')) {
      await respond({
        items: [
          { id: season, name: 'Сезон 2', active: true },
          { id: previousSeason, name: 'Сезон 1', active: false },
        ],
      });
    } else if (url.pathname.endsWith('/leaderboard')) {
      const offset = Number(url.searchParams.get('offset'));
      const count = offset === 20 ? 1 : 20;
      await respond({
        items: Array.from({ length: count }, (_, index) => ({
          rank: offset + index + 1,
          publicSlug: profileSlug,
          displayName: 'Тестов Т. Т.',
          points: '5.0000',
        })),
        limit: 20,
        offset,
        hasNext: offset === 0,
      });
    } else if (url.pathname.endsWith('/students')) {
      const offset = Number(url.searchParams.get('offset'));
      const count = offset === 24 ? 1 : 24;
      await respond({
        items: Array.from({ length: count }, (_, index) => ({
          publicSlug: index === 0 ? profileSlug : `fictional-${index}`,
          displayName: `Тестов-${index} Т. Т.`,
        })),
        limit: 24,
        offset,
        hasNext: offset === 0,
      });
    } else if (url.pathname.endsWith('/participations')) {
      const seasonal = url.searchParams.get('seasonId') === season;
      await respond({
        items: [
          {
            eventTitle: seasonal
              ? 'Мероприятие сезона'
              : 'Мероприятие из всей истории',
            points: '5.0000',
          },
        ],
        page: 1,
        pageSize: 25,
        hasNext: false,
      });
    } else if (url.pathname.endsWith(`/profiles/${profileSlug}`)) {
      await respond({
        publicSlug: profileSlug,
        displayName: 'Тестов Т. Т.',
        studyGroup: 'ТЕСТ-1',
        campus: 'Тестовая площадка',
      });
    } else await route.continue();
  });

  await page.goto(
    `/mos-active?season=${season}&rankOffset=20&q=%D0%A2%D0%B5%D1%81%D1%82&studentOffset=24`,
  );
  await expect(page.getByLabel('Сезон')).toHaveValue(season);
  await expect(
    page.getByRole('textbox', { name: 'Найти студента' }),
  ).toHaveValue('Тест');
  await expect(
    page.getByRole('list', { name: 'Рейтинг студентов' }),
  ).toHaveCount(0);
  const ranking = page.locator('.mos-active-ranking');
  await expect(ranking.getByRole('listitem')).toHaveCount(1);
  await expect(
    page.locator('.mos-active-list').last().getByRole('listitem'),
  ).toHaveCount(1);
  await ranking.getByRole('link').click();
  await expect(
    page.getByRole('heading', { name: 'Тестов Т. Т.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Баллы за мероприятия выбранного сезона',
    }),
  ).toBeVisible();
  await expect(page.getByText('Мероприятие сезона')).toBeVisible();
  await page
    .getByRole('button', { name: 'Показать начисления за все сезоны' })
    .click();
  await expect(page.getByText('Мероприятие из всей истории')).toBeVisible();
  await page.getByRole('link', { name: '← Все студенты' }).click();
  await expect(page.getByLabel('Сезон')).toHaveValue(season);
  await expect(
    page.getByRole('textbox', { name: 'Найти студента' }),
  ).toHaveValue('Тест');
  await expect(
    page.locator('.mos-active-ranking').getByRole('listitem'),
  ).toHaveCount(1);
  await expect(
    page.locator('.mos-active-list').last().getByRole('listitem'),
  ).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('rankOffset')).toBe('20');
  expect(new URL(page.url()).searchParams.get('studentOffset')).toBe('24');
});

test('exact page size has no empty next page', async ({ page }) => {
  await page.route('**/public/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith('/leaderboard/seasons'))
      body = { items: [{ id: season, name: 'Сезон 2', active: true }] };
    else if (url.pathname.endsWith('/leaderboard'))
      body = {
        items: Array.from({ length: 20 }, (_, index) => ({
          rank: index + 1,
          publicSlug: `rank-${index}`,
          displayName: `Тестов-${index} Т. Т.`,
          points: '0.0000',
        })),
        limit: 20,
        offset: 0,
        hasNext: false,
      };
    else
      body = {
        items: Array.from({ length: 24 }, (_, index) => ({
          publicSlug: `student-${index}`,
          displayName: `Тестов-${index} Т. Т.`,
        })),
        limit: 24,
        offset: 0,
        hasNext: false,
      };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/mos-active');
  await expect(
    page.locator('.mos-active-ranking').getByRole('listitem'),
  ).toHaveCount(20);
  await expect(
    page.locator('.mos-active-list').last().getByRole('listitem'),
  ).toHaveCount(24);
  for (const controls of await page.locator('.mos-active-pages').all()) {
    await expect(
      controls.getByRole('button', { name: 'Далее' }),
    ).toBeDisabled();
  }
});
