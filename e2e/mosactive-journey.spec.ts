import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse } from '@playwright/test';

import { demoCredentials } from './helpers.js';

const api = 'http://localhost:3000';
const levelId = '20000000-0000-4000-8000-000000000003';
const participantRoleId = '30000000-0000-4000-8000-000000000001';

async function accepted(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

test('fictional roster, registration, Scanner, review and public award form one journey', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const credentials = demoCredentials();
  const suffix = randomUUID().slice(0, 8);
  const surname = `Сквозной${suffix}`;
  const eventTitle = `Сквозное мероприятие ${suffix}`;
  const slug = `mos-journey-${suffix}`;
  const now = Date.now();
  const iso = (offsetHours: number) =>
    new Date(now + offsetHours * 3_600_000).toISOString();
  const fixtureDir = resolve('.runtime', 'e2e-roster-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const rosterPath = resolve(fixtureDir, `${suffix}.xlsx`);
  execFileSync(process.execPath, [
    'scripts/python.mjs',
    'e2e/create_roster_fixture.py',
    rosterPath,
    surname,
  ]);

  await page.goto('/admin');
  await page.getByLabel('Email').fill(credentials.adminEmail);
  await page.getByLabel('Пароль').fill(credentials.adminPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(
    page.getByRole('heading', { name: 'Мероприятия', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Контингент' }).click();
  await page.getByLabel('Файл контингента XLSX').setInputFiles(rosterPath);
  await page.getByRole('button', { name: 'Проверить файл' }).click();
  await expect(page.getByText('Новых студентов: 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить студентов' }).click();
  await expect(page.getByRole('status')).toContainText('1');

  const login = await accepted(
    await page.request.post(`${api}/auth/login`, {
      headers: { Origin: 'http://localhost:5173' },
      data: {
        email: credentials.adminEmail,
        password: credentials.adminPassword,
      },
    }),
  );
  const headers = {
    Origin: 'http://localhost:5173',
    'X-CSRF-Token': login.csrfToken as string,
  };
  const season = await accepted(
    await page.request.post(`${api}/admin/activity/seasons`, {
      headers,
      data: {
        code: `E2E_${suffix.toUpperCase()}`,
        name: `Тестовый сезон ${suffix}`,
        startsAt: iso(-24 * 30),
        endsAt: iso(24 * 30),
        active: false,
      },
    }),
    201,
  );
  const policy = await accepted(
    await page.request.post(`${api}/admin/activity/scoring-v2/policies`, {
      headers,
      data: { code: `E2E_${suffix.toUpperCase()}`, name: 'Тест: 10 × 2 × 1,5' },
    }),
    201,
  );
  const version = await accepted(
    await page.request.post(
      `${api}/admin/activity/scoring-v2/policies/${policy.id}/versions`,
      {
        headers,
        data: {
          roleBases: [{ classifierId: participantRoleId, value: '10.0000' }],
          levelMultipliers: [{ classifierId: levelId, value: '2.0000' }],
          statusMultipliers: [],
          newcomerTiers: [
            { sequenceFrom: 1, sequenceTo: null, value: '1.0000' },
          ],
          resultBonuses: [],
        },
      },
    ),
    201,
  );
  await accepted(
    await page.request.post(
      `${api}/admin/activity/scoring-v2/versions/${version.id}/publish`,
      { headers, data: { effectiveFrom: iso(-24 * 25) } },
    ),
  );
  await accepted(
    await page.request.post(
      `${api}/admin/activity/scoring-v2/seasons/${season.id}/policy`,
      {
        headers,
        data: { scoringPolicyId: policy.id, effectiveFrom: iso(-24 * 25) },
      },
    ),
  );
  const event = await accepted(
    await page.request.post(`${api}/admin/events`, {
      headers,
      data: {
        title: eventTitle,
        slug,
        startAt: iso(2),
        endAt: iso(4),
        registrationDeadline: iso(1),
        location: 'Тестовая площадка',
        capacity: 10,
        status: 'REGISTRATION_OPEN',
        seasonId: season.id,
        levelId,
        boostMultiplier: '1.5',
      },
    }),
    201,
  );
  const staff = await accepted(await page.request.get(`${api}/admin/staff`));
  const scanner = staff.items.find(
    (item: { email: string }) => item.email === credentials.scannerEmail,
  );
  expect(scanner).toBeTruthy();
  await accepted(
    await page.request.post(`${api}/admin/events/${event.id}/access`, {
      headers,
      data: { userId: scanner.id },
    }),
  );

  await page.goto(`/events/${slug}`);
  await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();
  await expect(page.getByText('Городской')).toBeVisible();
  await expect(page.getByText(/×1,5|x1,5/)).toBeVisible();
  await page.getByLabel(/^Фамилия/).fill(surname);
  await page.getByLabel(/^Имя/).fill('Тест');
  await page.getByLabel(/^Отчество/).fill('Петрович');
  await page.getByLabel(/^Дата рождения/).fill('2005-05-20');
  await page.getByLabel(/^Email/).fill(`journey-${suffix}@example.com`);
  await page.getByLabel(/^Телефон/).fill('+79990000001');
  await page.getByLabel(/^Статус участника/).selectOption('KAIT_STUDENT');
  await page.getByLabel('Найти группу', { exact: true }).fill('E2E-MOS');
  await page.getByLabel(/^Учебная группа/).selectOption('E2E-MOS');
  await page.getByLabel(/Я даю/).check();
  const registrationResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/public/events/${slug}/register`),
  );
  await page.getByRole('button', { name: 'Получить билет' }).click();
  const registration = await registrationResponse;
  expect(registration.ok(), await registration.text()).toBe(true);
  await page.getByRole('link', { name: 'Открыть билет' }).click();
  const qrImage = await page
    .getByRole('img', { name: 'QR-код билета' })
    .getAttribute('src');
  expect(qrImage).toBeTruthy();

  const scannerContext = await browser.newContext();
  try {
    const scannerPage = await scannerContext.newPage();
    await scannerPage.addInitScript((imageSource) => {
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
    await scannerPage.goto('http://localhost:5174');
    await scannerPage.getByLabel('Email').fill(credentials.scannerEmail);
    await scannerPage.getByLabel('Пароль').fill(credentials.scannerPassword);
    await scannerPage.getByRole('button', { name: 'Войти' }).click();
    const scannerEvent = scannerPage
      .getByRole('article')
      .filter({ hasText: eventTitle });
    await scannerEvent
      .getByRole('button', { name: /Подготовить и открыть|Открыть/ })
      .click();
    await expect(scannerPage.getByText(surname)).toBeVisible();
    await scannerPage
      .getByRole('button', { name: 'Подтвердить посещение' })
      .click();
    await expect(scannerPage.getByText(/Посещение подтверждено/)).toBeVisible();
  } finally {
    await scannerContext.close();
  }

  // Advance the event clock through the normal admin API in this isolated E2E DB.
  await accepted(
    await page.request.patch(`${api}/admin/events/${event.id}`, {
      headers,
      data: {
        startAt: iso(-2),
        endAt: iso(-1),
        registrationDeadline: iso(-3),
        status: 'ACTIVE',
      },
    }),
  );
  await page.goto('/admin');
  const eventCard = page.getByRole('article').filter({ hasText: eventTitle });
  await eventCard.getByRole('button', { name: 'Настроить' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Завершить и передать на проверку' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Мероприятие передано на проверку',
  );
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Проверить участие' }).click();
  await page
    .getByRole('button', { name: `${eventTitle} — открыть список` })
    .click();
  const student = page.getByRole('article').filter({ hasText: surname });
  await expect(student.getByLabel('Итоговое посещение')).toHaveValue('PRESENT');
  await expect(student).toContainText('Сопоставлен');
  await student.getByRole('button', { name: 'Рассчитать баллы' }).click();
  await expect(student).toContainText('30.0000');
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Утвердить и начислить баллы' })
    .click();
  await expect(
    page.getByText('Список утверждён. Начисления отражены в MosActive.'),
  ).toBeVisible();

  await page.goto(`/mos-active?season=${season.id}`);
  const rating = page.locator('.mos-active-ranking');
  const rankedStudent = rating
    .getByRole('listitem')
    .filter({ hasText: surname });
  await expect(rankedStudent).toContainText('30');
  await rankedStudent.getByRole('link').click();
  await expect(
    page.getByRole('heading', { name: `${surname} Т. П.` }),
  ).toBeVisible();
  await expect(page.getByText('E2E-MOS')).toBeVisible();
  await expect(page.getByText(eventTitle)).toBeVisible();
  await expect(page.getByText('30 баллов')).toBeVisible();
  await expect(page.getByText('journey-', { exact: false })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([]);
});
