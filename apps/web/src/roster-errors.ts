import { rosterValidationDetailsSchema } from '@event-registration/contracts';

import { AdminApiError } from './admin-api.js';

export const rosterErrorMessage = (error: unknown): string | undefined => {
  if (!(error instanceof AdminApiError)) return undefined;
  const fallback: Record<string, string> = {
    INVALID_ROSTER_FILE:
      'Не удалось прочитать таблицу. Выберите файл XLSX до 5 МБ с одним листом.',
    INVALID_ROSTER_HEADERS:
      'Проверьте заголовки: «Фамилия, Имя, Отчество, Группа» или семь столбцов шаблона «Реестр контингента».',
    INVALID_ROSTER_ROW: 'Проверьте ФИО и учебную группу в таблице.',
    DUPLICATE_ROSTER_STUDENT:
      'В файле повторяется студент с теми же ФИО и группой. Удалите повтор и проверьте файл снова.',
    ROSTER_STUDENT_EXISTS:
      'В базе уже есть студент с такими ФИО и группой. Исключите уже загруженные записи из файла. Существующие профили не изменены.',
    ROSTER_STUDENT_CONFLICT:
      'Найдена неоднозначная запись или отличающиеся данные существующего студента. Проверьте его карточку и исключите эту строку из повторного импорта. Данные не изменены.',
    ROSTER_FILE_CHANGED:
      'Файл изменился после проверки. Нажмите «Проверить файл» ещё раз.',
  };
  if (!fallback[error.code]) return undefined;
  const parsed = rosterValidationDetailsSchema.safeParse(error.details);
  if (!parsed.success) return fallback[error.code];
  const detail = parsed.data;
  const messages: Record<typeof detail.reason, string> = {
    FILE_TYPE:
      'Выберите файл Excel в формате .xlsx. Сохраните таблицу в этом формате и повторите загрузку.',
    FILE_TOO_LARGE: 'Файл больше 5 МБ. Разделите список на несколько файлов.',
    UNREADABLE_FILE:
      'Не удалось открыть файл. Откройте его в Excel и сохраните заново в формате .xlsx без пароля.',
    UNSAFE_ARCHIVE:
      'Структура XLSX повреждена или превышает допустимый размер. Скопируйте значения в новую книгу и сохраните её как .xlsx.',
    GRID_TOO_LARGE:
      'В книге слишком большой диапазон ячеек, в том числе пустых оформленных. Скопируйте только таблицу с данными в новую книгу и проверьте её.',
    SHEET_COUNT:
      'В файле должен быть один лист. Сохраните нужный лист в отдельный файл.',
    HEADERS: fallback.INVALID_ROSTER_HEADERS!,
    MERGED_CELLS:
      'Разъедините объединённые ячейки. Объединение допустимо только для заголовка «Реестр контингента» в A1:G1.',
    TOO_MANY_ROWS:
      'В файле больше 5000 студентов. Разделите список на несколько файлов.',
    FORMULA:
      'В ячейке формула. Замените формулы значениями и проверьте файл снова.',
    CELL_ERROR: 'В ячейке ошибка Excel. Исправьте её и проверьте файл снова.',
    EXTRA_COLUMNS:
      'За последним столбцом шаблона есть данные. Удалите лишние значения.',
    VALUE_TOO_LONG: `Значение слишком длинное${detail.maxLength ? `: допустимо до ${detail.maxLength} символов` : ''}.`,
    REQUIRED_VALUE:
      'Заполните обязательное поле: фамилию, имя или учебную группу.',
    FIO_PARTS:
      'В поле ФИО нужны фамилия и имя, затем отчество при наличии. Для составных имён используйте формат с отдельными столбцами «Фамилия, Имя, Отчество, Группа».',
    DUPLICATE_STUDENT: `ФИО и группа повторяют строку ${detail.firstRow ?? 'выше'}. Проверьте повтор перед загрузкой.`,
    EMPTY_ROSTER: 'В таблице нет студентов. Добавьте данные под заголовками.',
  };
  const location = detail.row
    ? `Строка ${detail.row}${detail.column ? `, столбец ${detail.column}` : ''}. `
    : '';
  return location + messages[detail.reason];
};
