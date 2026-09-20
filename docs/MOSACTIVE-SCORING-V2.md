# MosActive Scoring Engine v2

## Current scoring audit

До Stage 2 Activity использовал глобальные справочники `seasons`,
`event_categories`, `event_levels`, `participation_roles` и
`participation_results`. У Participation уже есть одна primary role и один result.
Legacy `scoring_rules` выбираются по Season, измерениям Event/Participation и
`Event.start_at`; начисления, отмены и ручные корректировки записываются в единый
неизменяемый ledger `score_transactions`. Историческое `membership_id` выбирается
по московской календарной дате Event. Отложенное подтверждение поэтому не меняет
исторический период правила или membership.

Stage 2 не удаляет эту модель и не меняет migrations 001–015. Миграция 016:

- переводит сумму ledger с INTEGER на `DECIMAL(12,4)` без пересчёта строк;
- добавляет organization-scoped `ScoringPolicy`, неизменяемые после публикации
  версии и нормализованные компоненты формулы;
- добавляет generic Person Status с периодами действия;
- добавляет стабильный `Participation.scoring_sequence` и расчётный snapshot;
- делает Season organization-scoped и позволяет явно назначить ему v2 policy.

Существующий Season без `scoring_policy_id` продолжает использовать v1. При
назначении policy обязательно задаётся `scoring_policy_effective_from`.
`Event.start_at` до этой границы использует v1, начиная с границы — v2. После
первого v2 AWARD policy и граница Season блокируются. Поэтому delayed scoring не
может задним числом сменить engine. Внутри v2 конкретная версия также выбирается
по `Event.start_at`. Category, Level, Role и Result остаются глобальными canonical
classifiers, а их значения задаёт policy Organization.

Назначение v2 также нельзя провести через уже существующую v1 history: если для
Event на границе или после неё есть engine-generated v1 AWARD, API возвращает
`SEASON_SCORING_POLICY_RETROACTIVE_CONFLICT`. Existing v1 awards не пересчитываются,
а администратор выбирает более позднюю границу. В migration historical marker `V1`
получают только legacy engine AWARD и связанный с ним REVERSAL. Manual Adjustment,
Legacy Import и другие нерасчётные ledger rows сохраняют `engine=NULL`.

## Formula and precision

Формула:

`role base × event level × all applicable person statuses × newcomer multiplier + result bonus`

Все операции выполняются Python `Decimal`. Промежуточные результаты не
округляются; только итог квантуется до четырёх знаков с `ROUND_HALF_UP`. API
возвращает баллы decimal-string, например `"16.7000"`.

Пример: Organizer `3.0000` × City `2.0000` × Profession Ambassador `1.5000`
× вторая Participation `1.3000` + first place `5.0000` = `16.7000`. Bonus
добавляется после всех множителей.

## Policies and history

Версия проходит `DRAFT → PUBLISHED → RETIRED`. Будущая опубликованная версия,
отменённая до начала, получает `CANCELLED`. Редактируется только DRAFT;
изменение правил требует новой версии. Effective interval опубликованных версий
не может пересекаться даже при конкурентной публикации: lifecycle блокирует Policy,
затем Version. Перед публикацией компоненты и непрерывность newcomer tiers повторно
проверяются из БД. Retirement не может обрезать interval перед Event уже созданного
AWARD. Production начисление и preview используют один calculator.
Ledger snapshot сохраняет IDs/codes/names/values всех компонентов, sequence,
subtotal, bonus, точный итог, policy/version, Event/Season/Participation/Person,
московскую дату, rounding mode и calculatedAt. Decimal значения — строки с четырьмя
знаками. `eventStartAt` всегда является UTC ISO 8601 с `Z`, а
`eventMoscowDate` — отдельной календарной датой. Snapshot не является public
surface. Reversal хранит отдельную оболочку с negative points и неизменённым
original calculation.

`PROFESSION_AMBASSADOR` — Person Status, а не ParticipationRole. Его применимость
проверяется по московской календарной дате Event. Retirement задаёт отдельную
exclusive historical boundary `retired_effective_on`: прошлые Event сохраняют
статус, а отменённый до начала будущий assignment не применяется. Overlap проверяет
фактические historical intervals, включая retired rows. Несколько статусов
перемножаются; операции сериализуются блокировкой Person.

Для уже действующего DATE-based статуса retirement сегодня означает exclusive
boundary завтра: статус действует включительно сегодня. Future assignment,
отменённый до `valid_from`, получает boundary = `valid_from` и никогда не начинает
действовать; более ранний natural `valid_to` не расширяется. Historical calculation
опирается на опубликованную PolicyVersion и effective assignment interval, а не на
текущий `PersonStatusType.active`. Inactive type по-прежнему нельзя назначить заново
или включить в новую публикуемую policy version.

Newcomer sequence расходуют только confirmed обычные Event Participation.
Присвоение сериализуется блокировкой Person и учитывает distinct Participation,
которые либо сейчас confirmed, либо имеют historical engine AWARD. Поэтому
последующий reversal/cancellation не удаляет уже занятую позицию. Persisted
`MAX(scoring_sequence)` остаётся нижней границей следующего номера; существующие
номера никогда не перенумеровываются. Sequence присваивается и сохраняется в той
же confirmation transaction, до проверки role/level/tier/result и до вычисления
формулы — порядок определяется моментом confirmation, а не успешным AWARD. Если
расчёт заканчивается NO_RULE (недостающий компонент policy version), Participation
остаётся CONFIRMED и сохраняет присвоенный номер навсегда; AWARD не создаётся, но
номер не теряется и не достаётся более поздней Participation. Preview
(`persist_sequence` не передан) вычисляет ожидаемый sequence, но ничего не пишет.
Повторная попытка (`award_score` после исправления policy version) переиспользует
уже сохранённый номер той же Participation.

## KAIT20 defaults

Миграция создаёт неактивированную policy `KAIT20_DEFAULT` и draft version 1.
До публикации и явного назначения Season она ничего не меняет.
Новые Stage 2 classifier seeds разрешаются только по exact `code` в DB collation:
если code уже существует с другим ID или пользовательским display name, row не
дублируется и не переписывается, а компоненты policy используют найденный ID.
Fuzzy/name matching не применяется.

- Role bases: PARTICIPANT 0.5, SPECTATOR 0.5, VOLUNTEER 1,
  CO_ORGANIZER 2, ORGANIZER 3, COORDINATOR 5.
- Level multipliers: DEPARTMENT 0.5, COLLEGE 1, CITY 2, DISTRICT 3,
  FEDERAL (National) 5.
- Status: PROFESSION_AMBASSADOR 1.5.
- Newcomer: #1 1.5, #2 1.3, #3 1.2, #4+ 1.
- Result bonus: LAUREATE/DIPLOMANT/ACKNOWLEDGEMENT +2;
  PRIZE_3/LAUREATE_III +3; PRIZE_2/LAUREATE_II +4;
  WINNER/LAUREATE_I +5; GRAND_PRIX/ABSOLUTE_WINNER +10.

Legacy classifiers SPEAKER, MENTOR, CAPTAIN, COMPETITOR, FINALIST and NOMINEE
remain intact. A component missing from the selected policy produces NO_RULE and
a diagnostic; no fallback score is invented.
