import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { demoCredentials } from './helpers.js';

async function rosterScreen(page: Page) {
  const credentials = demoCredentials();
  const api = 'http://localhost:3000';
  const login = await page.request.post(`${api}/auth/login`, {
    headers: { Origin: 'http://localhost:5173' },
    data: {
      email: credentials.adminEmail,
      password: credentials.adminPassword,
    },
  });
  expect(login.ok()).toBe(true);
  const headers = {
    Origin: 'http://localhost:5173',
    'X-CSRF-Token': (await login.json()).csrfToken as string,
  };
  const events = await (await page.request.get(`${api}/admin/events`)).json();
  const event = events.items.find(
    (item: { slug: string }) => item.slug === 'demo-event',
  );
  const suffix = String(Date.now()).slice(-7);
  const lastName = `Контингент-${suffix}`;
  const registration = await page.request.post(
    `${api}/admin/events/${event.id}/registrations/onsite`,
    {
      headers,
      data: {
        lastName,
        firstName: 'Тест',
        middleName: 'Тестович',
        birthDate: '2005-01-01',
        email: `roster-${randomUUID()}@example.com`,
        phone: `+7999${suffix}`,
        studyGroup: 'ТЕСТ-1',
        personType: 'KAIT_STUDENT',
        consentAccepted: true,
        requestId: randomUUID(),
        customAnswers: [],
      },
    },
  );
  expect(registration.ok(), await registration.text()).toBe(true);
  const detail = await (
    await page.request.get(
      `${api}/admin/events/${event.id}/registrations/${(await registration.json()).registrationId}`,
    )
  ).json();
  const personId = detail.personId as string;
  expect(
    (
      await page.request.post(`${api}/admin/people/${personId}/roster`, {
        headers,
      })
    ).ok(),
  ).toBe(true);
  const profile = await page.request.patch(
    `${api}/admin/people/${personId}/profile`,
    { headers, data: { visibility: 'PUBLIC' } },
  );
  expect(profile.ok()).toBe(true);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Контингент', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Поиск', exact: true })
    .fill(lastName);
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: lastName })
    .getByRole('button', { name: 'Открыть' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Данные контингента' }),
  ).toBeVisible();
  return {
    api,
    personId,
    headers,
    slug: (await profile.json()).publicSlug as string,
  };
}

test('roster edit reaches the public profile and fits a narrow viewport', async ({
  page,
}) => {
  const fixture = await rosterScreen(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel('Площадка', { exact: true })
    .fill('Новая тестовая площадка');
  await page
    .getByLabel('Специальность', { exact: true })
    .fill('Закрытая программа');
  await page
    .getByLabel('Причина изменения', { exact: true })
    .fill('Исправление площадки для теста');
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === 'PATCH' &&
      value.url().endsWith('/roster-metadata'),
  );
  await page
    .getByRole('button', { name: 'Сохранить данные контингента' })
    .click();
  expect((await response).status()).toBe(200);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Данные контингента сохранены' }),
  ).toBeVisible();
  const publicProfile = await (
    await page.request.get(`${fixture.api}/public/profiles/${fixture.slug}`)
  ).json();
  expect(publicProfile.campus).toBe('Новая тестовая площадка');
  expect(publicProfile).not.toHaveProperty('programName');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([]);
});

test('roster conflict preserves draft and requires explicit reload', async ({
  page,
}) => {
  const fixture = await rosterScreen(page);
  await page.getByLabel('Площадка', { exact: true }).fill('Локальная правка');
  await page
    .getByLabel('Причина изменения', { exact: true })
    .fill('Проверка конфликта');
  const current = await (
    await page.request.get(`${fixture.api}/admin/people/${fixture.personId}`)
  ).json();
  const external = await page.request.patch(
    `${fixture.api}/admin/people/${fixture.personId}/roster-metadata`,
    {
      headers: fixture.headers,
      data: {
        ...current.roster,
        campusAddress: 'Правка другого сотрудника',
        expectedVersion: current.rosterVersion,
        reason: 'Внешнее изменение',
      },
    },
  );
  expect(external.ok()).toBe(true);
  await page
    .getByRole('button', { name: 'Сохранить данные контингента' })
    .click();
  await expect(page.getByRole('alert')).toContainText('Другой сотрудник');
  await expect(page.getByLabel('Площадка', { exact: true })).toHaveValue(
    'Локальная правка',
  );
  await expect(
    page.getByRole('button', { name: 'Сохранить данные контингента' }),
  ).toBeDisabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '← Общая база' }).click();
  await expect(page.getByLabel('Площадка', { exact: true })).toHaveValue(
    'Локальная правка',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Загрузить актуальные данные' })
    .click();
  await expect(page.getByLabel('Площадка', { exact: true })).toHaveValue(
    'Правка другого сотрудника',
  );
});

test('super admin compares and merges a resolved duplicate without losing registration history', async ({
  page,
}) => {
  const fixture = await rosterScreen(page);
  const events = await (
    await page.request.get(`${fixture.api}/admin/events`)
  ).json();
  const event = events.items.find(
    (item: { slug: string }) => item.slug === 'demo-event',
  );
  const suffix = String(Date.now()).slice(-7);
  const lastName = `Дубликат-${suffix}`;
  const registration = await page.request.post(
    `${fixture.api}/admin/events/${event.id}/registrations/onsite`,
    {
      headers: fixture.headers,
      data: {
        lastName,
        firstName: 'Тест',
        middleName: 'Тестович',
        birthDate: '2004-02-02',
        email: `merge-${randomUUID()}@example.com`,
        phone: `+7998${suffix}`,
        studyGroup: 'ТЕСТ-2',
        personType: 'KAIT_STUDENT',
        consentAccepted: true,
        requestId: randomUUID(),
        customAnswers: [],
      },
    },
  );
  expect(registration.ok(), await registration.text()).toBe(true);
  const registrationId = (await registration.json()).registrationId as string;
  const source = await (
    await page.request.get(
      `${fixture.api}/admin/events/${event.id}/registrations/${registrationId}`,
    )
  ).json();
  const annulled = await page.request.post(
    `${fixture.api}/admin/events/${event.id}/registrations/${registrationId}/annul`,
    { headers: fixture.headers },
  );
  expect(annulled.ok(), await annulled.text()).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel('Найти вторую карточку по ФИО, группе или контакту')
    .fill(lastName);
  await page.getByRole('button', { name: 'Найти для сравнения' }).click();
  await page.getByRole('button', { name: 'Сравнить' }).click();
  await expect(
    page.getByRole('heading', { name: 'Сравнение историй' }),
  ).toBeVisible();
  await expect(page.getByText('Регистрации: 1 + 1')).toBeVisible();
  await page.getByLabel('Причина решения').fill('Проверены два профиля');
  page.once('dialog', (dialog) => dialog.accept());
  const merged = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/admin/people/${fixture.personId}/merge`),
  );
  await page
    .getByRole('button', { name: 'Объединить в основную карточку' })
    .click();
  expect((await merged).status()).toBe(200);
  await expect(
    page.getByText(
      'Карточки объединены. История сохранена в основной карточке.',
    ),
  ).toBeVisible();
  const target = await (
    await page.request.get(`${fixture.api}/admin/people/${fixture.personId}`)
  ).json();
  expect(target.registrations).toHaveLength(2);
  expect(
    (
      await page.request.get(`${fixture.api}/admin/people/${source.personId}`)
    ).status(),
  ).toBe(404);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
