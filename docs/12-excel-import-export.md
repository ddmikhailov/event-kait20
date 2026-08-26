# 12. Excel Import / Export

Статус: **Release 1.0 implementation**

## 1. Import scope

XLSX импортируется только внутрь выбранного Event. Импорт людей в общую базу без регистрации не нужен.

## 2. Email

Email у импортируемой записи может отсутствовать. Такая запись всё равно считается Registration и занимает capacity.

## 3. Workflow

1. Выбор Event.
2. Upload `.xlsx`.
3. Автоматическое сопоставление канонических колонок.
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

В MVP исходный XLSX хранится в приватной технической таблице MySQL только
между preview и commit. Срок жизни — не более 24 часов; payload удаляется сразу
после успешного commit либо при обнаружении истечения срока. `result_summary`
содержит только агрегаты и не становится постоянной копией PII. При переходе к
Object Storage этот временный payload можно вынести без изменения API workflow.

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
- hard limit 5 MiB and 5000 non-empty data rows;
- formulas/macros are not executed and unsupported formula cells are rejected or treated as inert values;
- exported user strings starting with spreadsheet formula prefixes are escaped/neutralized;
- merged cells are rejected;
- empty rows are ignored;
- commit re-checks capacity even after successful preview.

## 8. MVP template

Ровно один непустой worksheet. Первая строка — уникальные заголовки.

Обязательные колонки: `Фамилия`, `Имя`, `Дата рождения`, `Тип участника`,
`Телефон`. Опциональные: `Отчество`, `Группа`, `Организация`, `Email`.
Активные дополнительные поля используют заголовок `Поле: <label>`;
обязательное поле Event должно присутствовать. Регистр и повторяющиеся пробелы
в заголовках незначимы, произвольные синонимы в MVP не принимаются.

Значения типа участника: enum-идентификаторы либо `Студент КАИТ №20`,
`Преподаватель КАИТ №20`, `Студент другой организации`,
`Преподаватель другой организации`. Multi-choice разделяется `;`, boolean
принимает `Да/Нет`, `true/false` или `1/0`. Дата: `ДД.ММ.ГГГГ` или
`ГГГГ-ММ-ДД`.

При вероятном совпадении SUPER_ADMIN обязан явно выбрать: пропустить строку,
создать нового Person с флагом последующей dedup-проверки либо связать с одним
из предложенных Person. Тихого merge нет. Commit повторно читает исходный файл,
пересчитывает совпадения и capacity внутри транзакции.

Импорт разрешён для `DRAFT`, `REGISTRATION_OPEN`, `REGISTRATION_CLOSED` и
`ACTIVE`; завершённую или архивную историю дополнять импортом нельзя.
