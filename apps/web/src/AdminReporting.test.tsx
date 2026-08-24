import type { EventStatisticsResponse } from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StatisticsDashboard } from './AdminReporting.js';

const statistics: EventStatisticsResponse = {
  eventId: '10000000-0000-4000-8000-000000000001',
  capacity: 100,
  registered: 80,
  freePlaces: 20,
  attended: 60,
  absent: 20,
  attendancePercentage: 75,
  arrivalSeries: [
    {
      bucketStart: '2027-06-10T10:00:00.000Z',
      count: 12,
      cumulative: 12,
    },
  ],
};

describe('Event statistics dashboard', () => {
  it('renders the MVP metrics and arrival dynamics', () => {
    const markup = renderToStaticMarkup(
      <StatisticsDashboard statistics={statistics} timezone="Europe/Moscow" />,
    );

    expect(markup).toContain('Зарегистрировано');
    expect(markup).toContain('Посещаемость');
    expect(markup).toContain('75%');
    expect(markup).toContain('Динамика прихода');
    expect(markup).toContain('всего 12');
  });

  it('shows an honest empty state before the first attendance', () => {
    const markup = renderToStaticMarkup(
      <StatisticsDashboard
        statistics={{
          ...statistics,
          attended: 0,
          absent: 80,
          attendancePercentage: 0,
          arrivalSeries: [],
        }}
        timezone="Europe/Moscow"
      />,
    );

    expect(markup).toContain('Посещений пока нет');
  });
});
