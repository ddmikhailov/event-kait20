import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const eventId = '90000000-0000-4000-8000-000000000001';
const registrationId = '90000000-0000-4000-8000-000000000002';
const roleId = '90000000-0000-4000-8000-000000000003';
const headers = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Credentials': 'true',
};

async function reviewScreen(page: Page, failSave = false, count = 1) {
  const item = {
    registrationId,
    version: 'a'.repeat(64),
    lastName: 'Тестов',
    firstName: 'Тест',
    middleName: null,
    studyGroup: 'ТЕСТ-1',
    personType: 'KAIT_STUDENT',
    scannerFirstAttendedAt: '2026-01-01T10:00:00Z',
    attendanceDecision: 'PRESENT',
    attendanceChangedSinceReview: false,
    roleId,
    roleName: 'Участник',
    resultId: null,
    resultName: null,
    matchState: 'MATCHED',
    rosterPersonId: registrationId,
    decisionReason: null,
    reviewedAt: null,
  };
  const items = [
    item,
    ...Array.from({ length: count - 1 }, (_, index) => ({
      ...item,
      registrationId: `90000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      lastName: `Студент${index + 1}`,
    })),
  ];
  let approvals = 0;
  let approvedAttendance: string | undefined;
  let readsAfterApproval = 0;
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      headers,
      json: {
        authenticated: true,
        csrfToken: 'test-token-for-browser-review',
        expiresAt: '2099-01-01T00:00:00Z',
        user: { id: eventId, email: 'review@example.com', role: 'SUPER_ADMIN' },
      },
    }),
  );
  await page.route(/\/admin\/events(?:\?.*)?$/, (route) =>
    route.fulfill({
      headers,
      json: { items: [], page: 1, pageSize: 50, total: 0 },
    }),
  );
  await page.route('**/admin/activity/reviews/pending?*', (route) =>
    route.fulfill({
      headers,
      json: { items: [{ id: eventId, title: 'Тестовая сверка' }] },
    }),
  );
  await page.route('**/admin/activity/roles', (route) =>
    route.fulfill({
      headers,
      json: {
        items: [
          {
            id: roleId,
            code: 'PARTICIPANT',
            name: 'Участник',
            description: null,
            active: true,
            builtIn: true,
            sortOrder: 0,
          },
        ],
      },
    }),
  );
  await page.route('**/admin/activity/results', (route) =>
    route.fulfill({ headers, json: { items: [] } }),
  );
  await page.route(`**/admin/events/${eventId}/review**`, async (route) => {
    const request = route.request();
    if (request.url().includes('/score-preview')) {
      await route.fulfill({
        headers,
        json: {
          version: item.version,
          state: 'READY',
          code: null,
          points: '30.0000',
          calculation: {
            snapshotSchemaVersion: 1,
            engineVersion: 'V2',
            scoringPolicyId: eventId,
            policyVersionId: eventId,
            policyVersion: 1,
            policyVersionStatus: 'PUBLISHED',
            eventId,
            eventStartAt: '2026-01-01T10:00:00Z',
            eventMoscowDate: '2026-01-01',
            seasonId: eventId,
            participationId: registrationId,
            personId: registrationId,
            role: {
              id: roleId,
              code: 'PARTICIPANT',
              name: 'Участник',
              value: '10.0000',
            },
            level: {
              id: eventId,
              code: 'CITY',
              name: 'Городской',
              value: '2.0000',
            },
            statuses: [],
            newcomer: { sequence: 1, value: '1.0000' },
            result: null,
            eventBoost: '1.5000',
            multiplicativeSubtotal: '30.0000',
            resultBonus: '0.0000',
            finalPoints: '30.0000',
            roundingMode: 'ROUND_HALF_UP',
            calculatedAt: '2026-01-01T12:00:00Z',
          },
        },
      });
    } else if (request.url().endsWith('/approve')) {
      approvals += 1;
      approvedAttendance = item.attendanceDecision;
      await route.fulfill({
        headers,
        json: { registered: 1, present: 0, absent: 1, awarded: 0 },
      });
    } else if (request.method() === 'PATCH') {
      if (failSave) {
        await route.fulfill({
          headers,
          status: 409,
          json: {
            error: {
              code: 'REVIEW_ITEM_CHANGED',
              message: 'Changed',
              requestId: 'test',
            },
          },
        });
        return;
      }
      expect(request.postDataJSON().expectedVersion).toBe(item.version);
      Object.assign(item, request.postDataJSON(), { version: 'b'.repeat(64) });
      await route.fulfill({
        headers,
        json: {
          eventId,
          title: 'Тестовая сверка',
          state: 'PENDING',
          items,
        },
      });
    } else if (approvals) {
      readsAfterApproval += 1;
      await route.fulfill({
        headers,
        status: 500,
        json: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Unavailable',
            requestId: 'test',
          },
        },
      });
    } else {
      await route.fulfill({
        headers,
        json: {
          eventId,
          title: 'Тестовая сверка',
          state: 'PENDING',
          items,
        },
      });
    }
  });
  await page.goto('/admin');
  await page
    .getByRole('button', { name: 'Проверить участие', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Тестовая сверка — открыть список' })
    .click();
  await expect(page.getByLabel('Итоговое посещение').first()).toHaveValue(
    'PRESENT',
  );
  return () => ({ approvals, approvedAttendance, readsAfterApproval });
}

test('roster suggestion shows differences and stays a draft until staff saves', async ({
  page,
}, testInfo) => {
  await reviewScreen(page);
  const selectedId = '90000000-0000-4000-8000-000000000099';
  await page.route('**/roster-suggestions', (route) =>
    route.fulfill({
      headers,
      json: {
        items: [
          {
            id: selectedId,
            lastName: 'Тестов',
            firstName: 'Тест',
            middleName: 'Составное Отчество',
            studyGroup: 'ТЕСТ-1',
            differingFields: ['middleName'],
          },
        ],
        truncated: false,
      },
    }),
  );
  let saved = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      request.url().endsWith(`/review/${registrationId}`)
    ) {
      expect(request.postDataJSON().rosterPersonId).toBe(selectedId);
      saved += 1;
    }
  });
  await page
    .getByRole('button', { name: 'Найти студента', exact: true })
    .click();
  await expect(
    page.getByText(
      'Отчество: в заявке «не указано», в реестре «Составное Отчество»',
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('roster-suggestions-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Выбрать эту запись' }).click();
  expect(saved).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Утвердить и начислить баллы' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Сохранить', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('Причина изменения', { exact: true })
    .fill('ФИО уточнено у участника');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByText('Решение сохранено.', { exact: true }),
  ).toBeVisible();
  expect(saved).toBe(1);
});

test('dirty review cannot approve or refresh; saved decision determines approval', async ({
  page,
}) => {
  const state = await reviewScreen(page);
  await page.getByLabel('Итоговое посещение').selectOption('ABSENT');
  const approve = page.getByRole('button', {
    name: 'Утвердить и начислить баллы',
  });
  await expect(approve).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Проверить новые отметки' }),
  ).toBeDisabled();
  await page
    .getByLabel('Причина изменения', { exact: true })
    .fill('Сверка списка');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(approve).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await approve.click();
  await expect(
    page.getByText('Список утверждён. Начисления отражены в MosActive.'),
  ).toBeVisible();
  expect(state()).toEqual({
    approvals: 1,
    approvedAttendance: 'ABSENT',
    readsAfterApproval: 0,
  });
});

test('failed save preserves draft and prevents approval; leaving asks to discard', async ({
  page,
}) => {
  const state = await reviewScreen(page, true);
  await page.getByLabel('Итоговое посещение').selectOption('ABSENT');
  await page
    .getByLabel('Причина изменения', { exact: true })
    .fill('Сверка списка');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText(/Карточка изменилась:/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Утвердить и начислить баллы' }),
  ).toBeDisabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '← Очередь проверки' }).click();
  await expect(page.getByLabel('Итоговое посещение')).toHaveValue('ABSENT');
  expect(state().approvals).toBe(0);
});

test('repeating an unchanged public search reloads, including after failure', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/public/leaderboard/seasons', (route) =>
    route.fulfill({ headers, json: { items: [] } }),
  );
  await page.route('**/public/students?*', (route) => {
    requests += 1;
    return route.fulfill({
      headers,
      ...(requests === 3
        ? {
            status: 500,
            json: {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Unavailable',
                requestId: 'test',
              },
            },
          }
        : { json: { items: [], limit: 20, offset: 0, hasNext: false } }),
    });
  });
  await page.goto('/mos-active');
  await expect(
    page.getByText('Опубликованных профилей пока нет.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByText('Загружаем студентов…')).toBeHidden();
  await page.getByLabel('Найти студента', { exact: true }).fill('Тестов');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect.poll(() => requests).toBe(4);
  await expect(
    page.getByText('По запросу нет опубликованных профилей.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('large review pages preserve hidden drafts and search all participants', async ({
  page,
}) => {
  await reviewScreen(page, false, 5000);
  await expect(page.getByLabel('Итоговое посещение')).toHaveCount(25);
  await page.getByLabel('Итоговое посещение').first().selectOption('ABSENT');
  await page
    .getByRole('button', { name: 'Следующие участники', exact: true })
    .click();
  await expect(page.getByText('Страница 2 из 200')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Утвердить и начислить баллы' }),
  ).toBeDisabled();
  await page.getByLabel('Поиск по участникам').fill('Студент4999');
  await expect(page.getByLabel('Итоговое посещение')).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Студент4999 Тест' }),
  ).toBeVisible();
  await page.getByLabel('Поиск по участникам').fill('');
  await page
    .getByRole('combobox', { name: 'Показать', exact: true })
    .selectOption('DIRTY');
  await expect(page.getByLabel('Итоговое посещение')).toHaveCount(1);
  await expect(page.getByLabel('Итоговое посещение')).toHaveValue('ABSENT');
});

for (const count of [500, 5000]) {
  test(`review of ${count} participants fits a narrow screen and explains score`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await reviewScreen(page, false, count);
    await page
      .getByRole('button', { name: 'Рассчитать баллы' })
      .first()
      .click();
    await expect(
      page.getByText('Предварительный результат: 30.0000'),
    ).toBeVisible();
    await page.getByText('Предварительный результат: 30.0000').click();
    await expect(
      page.getByText(/коэффициент мероприятия: 1.5000/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(({ impact }) =>
        ['critical', 'serious'].includes(impact ?? ''),
      ),
    ).toEqual([]);
  });
}
