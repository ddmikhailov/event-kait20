import {
  createEventRequestSchema,
  createFormFieldRequestSchema,
  seasonValuesSchema,
  type CreateEventRequest,
  type CreateFormFieldRequest,
  type EventResponse,
  type FormFieldResponse,
  type SeasonValues,
} from '@event-registration/contracts';

const MOSCOW_TIMEZONE = 'Europe/Moscow';

// `currentDirectionId` is `undefined` for a brand-new Event (create - the
// field is always included, legacy `direction` is never sent from this UI
// at all - Stage 4 Final Cleanup, item C) and `event.directionId ?? null`
// for an existing one (update). When editing, the `directionId` key is
// only included in the parsed request if the admin actually changed the
// selection - omitted entirely otherwise, so an untouched Event whose
// Direction has since been deactivated never re-triggers the backend's
// resolve_direction() validation (which would reject it with
// DIRECTION_INACTIVE) just because an unrelated field was edited.
//
// Critical HTML form-submission detail: a `<select>`'s currently-selected
// `<option>` is NOT included in the submitted FormData if that option is
// `disabled` - which is exactly the case for the current, since-deactivated
// Direction's option (see EventForm). So `form.has('directionId')` being
// false does not mean "no Direction" - it means "the field was never a
// successful form control", which on UPDATE must read as "unchanged",
// never as "detach". Only an explicitly PRESENT-but-empty field (the admin
// picked the real "Без направления" option, which is never disabled) means
// the admin explicitly cleared it - that must still send `directionId: null`.
export const eventValues = (
  form: FormData,
  currentDirectionId?: string | null,
): CreateEventRequest => {
  const timezone = 'Europe/Moscow';
  const hasDirectionField = form.has('directionId');
  const directionId = hasDirectionField
    ? optionalText(form, 'directionId')
    : (currentDirectionId ?? null);
  const directionUnchanged =
    currentDirectionId !== undefined &&
    (!hasDirectionField || (currentDirectionId ?? '') === (directionId ?? ''));
  return createEventRequestSchema.parse({
    seasonId: optionalText(form, 'seasonId'),
    categoryId: optionalText(form, 'categoryId'),
    levelId: optionalText(form, 'levelId'),
    isListed: form.has('visibilityConfigured') ? form.has('isListed') : true,
    allowedPersonTypes: form.has('allowedPersonTypesConfigured')
      ? form.getAll('allowedPersonTypes').map(String)
      : null,
    title: text(form, 'title'),
    slug: text(form, 'slug'),
    description: optionalText(form, 'description'),
    ...(directionUnchanged ? {} : { directionId }),
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

export const seasonValues = (form: FormData): SeasonValues =>
  seasonValuesSchema.parse({
    code: text(form, 'code').trim().toUpperCase(),
    name: text(form, 'name').trim(),
    startsAt: zonedLocalToIso(text(form, 'startsAt'), MOSCOW_TIMEZONE),
    endsAt: zonedLocalToIso(text(form, 'endsAt'), MOSCOW_TIMEZONE),
    active: form.get('active') === 'on',
  });

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
    onsiteRequired: form.has('onsiteRequired'),
    sortOrder: Number(text(form, 'sortOrder')),
    options,
  });
};

export const eventDefaults = (event?: EventResponse) => ({
  seasonId: event?.seasonId ?? '',
  categoryId: event?.categoryId ?? '',
  levelId: event?.levelId ?? '',
  isListed: event?.isListed ?? true,
  allowedPersonTypes: event?.allowedPersonTypes ?? null,
  title: event?.title ?? '',
  slug: event?.slug ?? '',
  description: event?.description ?? '',
  directionId: event?.directionId ?? '',
  startAt: event ? isoToZonedLocal(event.startAt, 'Europe/Moscow') : '',
  endAt: event ? isoToZonedLocal(event.endAt, 'Europe/Moscow') : '',
  timezone: 'Europe/Moscow',
  location: event?.location ?? '',
  registrationDeadline: event
    ? isoToZonedLocal(event.registrationDeadline, 'Europe/Moscow')
    : '',
  capacity: event?.capacity ?? 1,
  status: event?.status ?? 'DRAFT',
});

export const formFieldDefaults = (field?: FormFieldResponse) => ({
  type: field?.type ?? 'SHORT_TEXT',
  label: field?.label ?? '',
  required: field?.required ?? false,
  onsiteRequired: field?.onsiteRequired ?? field?.required ?? false,
  sortOrder: field?.sortOrder ?? 0,
  options: field?.options?.join('\n') ?? '',
});

export const zonedLocalToIso = (value: string, timezone: string): string => {
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
