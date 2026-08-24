import {
  createEventRequestSchema,
  createFormFieldRequestSchema,
  type CreateEventRequest,
  type CreateFormFieldRequest,
  type EventResponse,
  type FormFieldResponse,
} from '@event-registration/contracts';

export const eventValues = (form: FormData): CreateEventRequest => {
  const timezone = text(form, 'timezone');
  return createEventRequestSchema.parse({
    title: text(form, 'title'),
    slug: text(form, 'slug'),
    description: optionalText(form, 'description'),
    coverObjectKey: optionalText(form, 'coverObjectKey'),
    startAt: zonedLocalToIso(text(form, 'startAt'), timezone),
    endAt: zonedLocalToIso(text(form, 'endAt'), timezone),
    timezone,
    location: text(form, 'location'),
    registrationDeadline: zonedLocalToIso(
      text(form, 'registrationDeadline'),
      timezone,
    ),
    capacity: Number(text(form, 'capacity')),
    status: text(form, 'status'),
  });
};

export const formFieldValues = (form: FormData): CreateFormFieldRequest => {
  const type = text(form, 'type');
  const choice = type === 'SINGLE_CHOICE' || type === 'MULTI_CHOICE';
  const options = choice
    ? text(form, 'options')
        .split('\n')
        .map((option) => option.trim())
        .filter(Boolean)
    : null;
  return createFormFieldRequestSchema.parse({
    type,
    label: text(form, 'label'),
    required: form.get('required') === 'on',
    sortOrder: Number(text(form, 'sortOrder')),
    options,
  });
};

export const eventDefaults = (event?: EventResponse) => ({
  title: event?.title ?? '',
  slug: event?.slug ?? '',
  description: event?.description ?? '',
  coverObjectKey: event?.coverObjectKey ?? '',
  startAt: event ? isoToZonedLocal(event.startAt, event.timezone) : '',
  endAt: event ? isoToZonedLocal(event.endAt, event.timezone) : '',
  timezone: event?.timezone ?? 'Europe/Moscow',
  location: event?.location ?? '',
  registrationDeadline: event
    ? isoToZonedLocal(event.registrationDeadline, event.timezone)
    : '',
  capacity: event?.capacity ?? 1,
  status: event?.status ?? 'DRAFT',
});

export const formFieldDefaults = (field?: FormFieldResponse) => ({
  type: field?.type ?? 'SHORT_TEXT',
  label: field?.label ?? '',
  required: field?.required ?? false,
  sortOrder: field?.sortOrder ?? 0,
  options: field?.options?.join('\n') ?? '',
});

const zonedLocalToIso = (value: string, timezone: string): string => {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = (datePart ?? '').split('-').map(Number);
  const [hour, minute] = (timePart ?? '').split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    return new Date(Number.NaN).toISOString();
  }
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const firstOffset = timezoneOffsetAt(new Date(localAsUtc), timezone);
  const firstInstant = new Date(localAsUtc - firstOffset);
  const resolvedOffset = timezoneOffsetAt(firstInstant, timezone);
  return new Date(localAsUtc - resolvedOffset).toISOString();
};

const isoToZonedLocal = (value: string, timezone: string): string => {
  const parts = dateTimeParts(new Date(value), timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

const timezoneOffsetAt = (date: Date, timezone: string): number => {
  const parts = dateTimeParts(date, timezone);
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    ) - date.getTime()
  );
};

const dateTimeParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
};

const text = (form: FormData, key: string): string =>
  String(form.get(key) ?? '').trim();

const optionalText = (form: FormData, key: string): string | null =>
  text(form, key) || null;
