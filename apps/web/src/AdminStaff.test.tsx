import type {
  EventAccessListResponse,
  StaffListResponse,
} from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccessList, StaffList } from './AdminStaff.js';

const admin: StaffListResponse['items'][number] = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'admin@example.test',
  role: 'SUPER_ADMIN',
  active: true,
  createdAt: '2026-08-24T10:00:00.000Z',
};
const scanner: StaffListResponse['items'][number] = {
  id: '20000000-0000-4000-8000-000000000001',
  email: 'scanner@example.test',
  role: 'SCANNER',
  active: true,
  createdAt: '2026-08-24T10:00:00.000Z',
};

describe('staff administrator views', () => {
  it('protects the current administrator from UI self-deactivation', () => {
    const markup = renderToStaticMarkup(
      <StaffList
        staff={[admin, scanner]}
        currentUserId={admin.id}
        busy={false}
        onDeactivate={async () => undefined}
      />,
    );
    expect(markup).toContain('Текущая учётная запись');
    expect(markup.match(/Деактивировать/g)).toHaveLength(1);
    expect(markup).toContain('Сканировщик');
  });

  it('renders inactive staff without a deactivation action', () => {
    const markup = renderToStaticMarkup(
      <StaffList
        staff={[{ ...scanner, active: false }]}
        currentUserId={admin.id}
        busy={false}
        onDeactivate={async () => undefined}
      />,
    );
    expect(markup).toContain('Отключён');
    expect(markup).not.toContain('Деактивировать');
  });

  it('renders explicit event access assignments', () => {
    const access: EventAccessListResponse['items'] = [
      {
        userId: scanner.id,
        email: scanner.email,
        role: 'SCANNER',
        createdAt: scanner.createdAt,
      },
    ];
    const markup = renderToStaticMarkup(
      <AccessList
        access={access}
        busy={false}
        onRemove={async () => undefined}
      />,
    );
    expect(markup).toContain('scanner@example.test');
    expect(markup).toContain('Убрать доступ');
  });
});
