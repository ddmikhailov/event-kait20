import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { demoCredentials } from './helpers.js';

const readQueue = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<
        {
          clientEventId: string;
          registrationId: string;
          eventId: string;
          deviceId: string;
          mode: string;
          source: string;
          deviceScannedAt: string;
          estimatedScannedAt: string;
          status: string;
        }[]
      >((resolve, reject) => {
        const open = indexedDB.open('event-registration-scanner');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction('pendingAttendance', 'readonly');
          const request = transaction.objectStore('pendingAttendance').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          transaction.oncomplete = () => db.close();
        };
      }),
  );

test('production PWA update preserves offline attendance and does not reload another tab', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  const nonce = Date.now();
  const lastName = `Обновление-${nonce}`;
  await page.goto('/events/demo-event');
  await page.getByLabel(/^Фамилия/).fill(lastName);
  await page.getByLabel(/^Имя/).fill('Тест');
  await page.getByLabel(/^Дата рождения/).fill('2005-05-20');
  await page.getByLabel(/^Email/).fill(`pwa-${nonce}@example.com`);
  await page.getByLabel(/^Телефон/).fill(`+7999${String(nonce).slice(-7)}`);
  await page.getByLabel(/^Статус участника/).selectOption('KAIT_STUDENT');
  await page.getByLabel(/^Учебная группа/).selectOption('__missing__');
  await page.getByLabel(/Я даю/).check();
  await page.getByRole('button', { name: 'Получить билет' }).click();
  await expect(page.getByText('Регистрация завершена')).toBeVisible();

  const credentials = demoCredentials();
  await page.goto('http://localhost:5174');
  await page.getByLabel('Email').fill(credentials.scannerEmail);
  await page.getByLabel('Пароль').fill(credentials.scannerPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration())?.active),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await page
    .getByRole('article')
    .filter({ hasText: 'Демонстрационное мероприятие' })
    .getByRole('button', { name: 'Подготовить и открыть' })
    .click();
  await expect(page.getByText('Данные синхронизированы')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Режим работы' })
    .getByRole('button', { name: 'Найти', exact: true })
    .click();
  await context.setOffline(true);
  await page.getByLabel('ФИО, телефон, email или группа').fill(lastName);
  await page
    .locator('form')
    .getByRole('button', { name: 'Найти', exact: true })
    .click();
  await page.getByRole('button', { name: new RegExp(lastName) }).click();
  await page.getByRole('button', { name: 'Подтвердить посещение' }).click();
  await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();
  const queued = await readQueue(page);
  expect(queued).toHaveLength(1);
  await page.getByRole('button', { name: '← Назад' }).click();
  await expect(
    page.getByRole('heading', { name: 'Куда отмечаем вход?' }),
  ).toBeVisible();
  await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();

  // Publish a second revision of the built HTML/precache manifest. This uses a
  // real waiting service worker and production assets, not mocked SW callbacks.
  // Restore the preview files even on failure; source files are never changed.
  const htmlPath = resolve('apps/scanner/dist/index.html');
  const swPath = resolve('apps/scanner/dist/sw.js');
  const html = await readFile(htmlPath, 'utf8');
  const sw = await readFile(swPath, 'utf8');
  const htmlNext = html.replace(
    '</head>',
    '<meta name="pwa-test-revision" content="next"></head>',
  );
  const hash = (value: string) => createHash('md5').update(value).digest('hex');
  expect(sw).toContain(hash(html));
  const swNext = sw.replace(hash(html), hash(htmlNext));
  const other = await context.newPage();
  try {
    await context.setOffline(false);
    await other.goto('http://localhost:5174');
    await expect(
      other.getByRole('heading', { name: 'Куда отмечаем вход?' }),
    ).toBeVisible();
    await writeFile(htmlPath, htmlNext);
    await writeFile(swPath, swNext);
    await page.evaluate(async () =>
      (await navigator.serviceWorker.ready).update(),
    );
    await expect(
      page.getByRole('button', { name: 'Обновить Scanner' }),
    ).toBeVisible();
    await expect(
      other.getByRole('button', { name: 'Обновить Scanner' }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('scanner-update.png'),
      fullPage: true,
    });
    await context.setOffline(true);
    // The other tab is actively viewing an event when the first applies an update.
    await other
      .getByRole('article')
      .filter({ hasText: 'Демонстрационное мероприятие' })
      .getByRole('button', { name: 'Открыть', exact: true })
      .click();
    await expect(
      other.getByRole('heading', { name: 'Демонстрационное мероприятие' }),
    ).toBeVisible();
    await expect(
      other.getByRole('button', { name: 'Обновить Scanner' }),
    ).toHaveCount(0);
    let otherNavigations = 0;
    other.on('framenavigated', () => otherNavigations++);
    await page.getByRole('button', { name: 'Обновить Scanner' }).click();
    await expect(
      page.locator('meta[name="pwa-test-revision"]'),
    ).toHaveAttribute('content', 'next');
    await expect(
      page.getByRole('heading', { name: 'Куда отмечаем вход?' }),
    ).toBeVisible();
    expect(await readQueue(page)).toEqual(queued);
    expect(otherNavigations).toBe(0);
    await expect(
      other.getByRole('heading', { name: 'Демонстрационное мероприятие' }),
    ).toBeVisible();
    await other.close();

    await page
      .getByRole('article')
      .filter({ hasText: 'Демонстрационное мероприятие' })
      .getByRole('button', { name: 'Открыть', exact: true })
      .click();
    await expect(page.getByText('OFFLINE · 1 ожидают')).toBeVisible();
    const synced = page.waitForResponse(
      (response) =>
        response.url().endsWith('/attendance/sync') &&
        response.request().method() === 'POST',
    );
    await context.setOffline(false);
    const result = await (await synced).json();
    expect(result.results).toEqual([
      expect.objectContaining({
        clientEventId: queued[0]!.clientEventId,
        status: 'ACCEPTED',
      }),
    ]);
    await expect(page.getByText('ONLINE · синхронизировано')).toBeVisible();
    expect(await readQueue(page)).toEqual([]);
    // Simulate a lost response: replay the same operation, never a new mark.
    const session = await page.request.get(
      'http://localhost:3000/auth/session',
    );
    const { csrfToken } = await session.json();
    const attendance = queued[0]!;
    const { deviceId, eventId } = attendance;
    const replay = await page.request.post(
      `http://localhost:3000/scanner/events/${eventId}/attendance/sync`,
      {
        headers: { 'x-csrf-token': csrfToken, origin: 'http://localhost:5174' },
        data: {
          deviceId,
          events: [
            {
              clientEventId: attendance.clientEventId,
              registrationId: attendance.registrationId,
              mode: attendance.mode,
              source: attendance.source,
              deviceScannedAt: attendance.deviceScannedAt,
              estimatedScannedAt: attendance.estimatedScannedAt,
            },
          ],
        },
      },
    );
    expect(replay.ok(), await replay.text()).toBe(true);
    const repeated = await replay.json();
    expect(repeated.results[0].status).toBe('ALREADY_PROCESSED');
    expect(repeated.results[0].firstAttendedAt).toBe(
      result.results[0].firstAttendedAt,
    );
  } finally {
    await other.close();
    await context.setOffline(false);
    await writeFile(htmlPath, html);
    await writeFile(swPath, sw);
  }
});
