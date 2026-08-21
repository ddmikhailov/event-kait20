# 12. Excel Import / Export

Статус: **Approved workflow / Draft validation details**

## 1. Import scope

XLSX импортируется только внутрь выбранного Event. Импорт людей в общую базу без регистрации не нужен.

## 2. Email

Email у импортируемой записи может отсутствовать. Такая запись всё равно считается Registration и занимает capacity.

## 3. Workflow

1. Выбор Event.
2. Upload `.xlsx`.
3. Mapping колонок.
4. Server validation.
5. Preview.
6. Admin confirmation.
7. Transactional import.
8. Result summary.
9. Отдельная массовая отправка QR при наличии email.

## 4. Preview categories

- новые;
- уже зарегистрированные;
- вероятные совпадения;
- ошибки;
- строки без email;
- итоговое влияние на capacity.

## 5. Temporary file

Исходный XLSX не должен храниться постоянно без необходимости. Предпочтительно temporary Object Storage с автоматическим удалением, например через 24 часа.

## 6. Export

Экспорт выбранного Event в `.xlsx` включает минимум:
- фамилия;
- имя;
- отчество;
- дата рождения;
- статус;
- группа;
- организация;
- телефон;
- email;
- дата регистрации;
- источник регистрации;
- пришёл/не пришёл;
- время первого посещения;
- дополнительные ответы формы.

## 7. Security/validation baseline

- extension + MIME/content validation;
- configurable hard file-size and row-count limit;
- formulas/macros are not executed and unsupported formula cells are rejected or treated as inert values;
- exported user strings starting with spreadsheet formula prefixes are escaped/neutralized;
- merged cells are not part of the recommended template and require deterministic rejection/normalization;
- empty rows are ignored;
- commit re-checks capacity even after successful preview.

## 8. TODO before Excel feature implementation

- publish exact recommended XLSX template;
- choose initial file/row limits based on staging tests;
- exact accepted Russian column aliases.
