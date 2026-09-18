import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { streamTime, StreamSelector } from './EventStreams.js';

const stream = {
  id: '10000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000002',
  title: 'Утренний поток',
  startAt: '2027-10-10T07:00:00Z',
  endAt: '2027-10-10T08:00:00Z',
  capacity: 1,
  registered: 1,
  remaining: 0,
  sortOrder: 0,
  active: true,
  ended: false,
};
describe('stream selection', () => {
  it('uses Moscow time and prevents public selection of a full stream', () => {
    expect(streamTime(stream)).toContain('10:00');
    const markup = renderToStaticMarkup(<StreamSelector streams={[stream]} />);
    expect(markup).toContain('required=""');
    expect(markup).toContain(`value="${stream.id}" disabled=""`);
    expect(markup).not.toContain('multiple');
  });
  it('allows staff to select a full stream before explicit overbooking confirmation', () => {
    const markup = renderToStaticMarkup(
      <StreamSelector streams={[stream]} onsite />,
    );
    expect(markup).not.toContain(`value="${stream.id}" disabled=""`);
  });
});
