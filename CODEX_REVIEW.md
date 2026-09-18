# MosActive Stage 2 — Final Historical Integrity Review

## Finding status

1. **V2 activation cannot cross existing V1 awards — FIXED.** Assigning or moving
   a Season v2 boundary is rejected with
   `SEASON_SCORING_POLICY_RETROACTIVE_CONFLICT` when an engine-generated v1 AWARD
   already exists for an Event at or after the requested boundary. No award is
   recalculated and the Season assignment remains unchanged.
2. **Historical engine marker semantics — FIXED.** Migration 016 marks only a
   legacy ScoringRule AWARD and its linked engine REVERSAL as `V1`. Manual
   Adjustment, Legacy Import and other non-engine rows keep `engine=NULL`.
3. **Cancelled/reversed pre-v2 Participation remains in newcomer baseline —
   FIXED.** The baseline counts distinct Participation IDs that are currently
   confirmed or have a historical engine AWARD. AWARD plus REVERSAL is never
   double-counted, and persisted `MAX(scoring_sequence)` remains the lower bound.
4. **Inactive StatusType cannot erase historical multiplier — FIXED.** Historical
   production lookup uses the published PolicyVersion and assignment interval,
   not current classifier activity. Inactive types remain forbidden for new
   assignments and new policy publication.
5. **Stage2 classifier seeds reuse existing codes — FIXED.** New Stage 2 seeds use
   exact code matching through the database collation. Existing IDs and display
   names are preserved, and KAIT20 policy components resolve those actual IDs.
6. **eventStartAt snapshot is explicit UTC — FIXED.** Canonical snapshots emit ISO
   8601 UTC with `Z`; the shared contract rejects an offset timestamp even when it
   represents the same instant. `eventMoscowDate` remains a separate date.
7. **DATE-based status retirement same-day semantics — FIXED.** Retirement of an
   already-effective status uses tomorrow as the exclusive boundary, preserving
   the entire current Moscow day. Future cancellation uses `valid_from`; an
   earlier natural `valid_to` is never extended.

## Scope and base

- Branch: `feature/mosactive-scoring-v2`
- Review base and current HEAD:
  `6c98992ba403f15d1a507e4c457402bce3290c0d`
- Product mode: KAIT20-first / replication-ready
- Migration 016 was corrected in place because it remains unaccepted,
  uncommitted and undeployed.
- Migrations 001–015 remain unchanged relative to the base.
- Stage 3, commit, push and deployment were not performed.

## Historical-integrity changes

Season assignment now checks both sides of engine history:

- after a v2 AWARD, policy and activation boundary remain immutable;
- before the first v2 AWARD, a requested boundary still cannot cross an existing
  v1 AWARD for the Season;
- a boundary after the last Event with v1 AWARD remains valid;
- delayed Participation of the same old Event therefore stays on v1.

Newcomer reconstruction uses distinct historical Participation evidence. A
cancelled Participation with an engine AWARD still consumed its position even
after REVERSAL. Manual/import/registration/attendance data does not count as
evidence. Existing stored sequences are never cleared or renumbered.

Historical Person Status calculation no longer joins on current
`person_status_types.active`. Activity is still checked when creating a new
assignment and when publishing a new PolicyVersion, preserving both administrative
safety and reproducibility of delayed scoring.

## Migration report

### Engine marker backfill

Migration 016 updates `scoring_engine_version` only when:

- the row is an `AWARD`, source is `SCORING_ENGINE`, and it references a legacy
  `scoring_rule_id`; or
- the row is a `REVERSAL` whose `original_transaction_id` points to such an AWARD.

`MANUAL_ADJUSTMENT`, `LEGACY_IMPORT` and unrelated rows remain null. Points, IDs,
original references and source fields are unchanged. New manual adjustments also
omit the engine marker.

### Classifier collision handling

The new Stage 2 Event Level, Role and Result rows are inserted with collision-safe
exact-code semantics. If a code does not exist, the canonical seed row is created.
If it already exists with another UUID, migration does not create a duplicate or
rewrite its name. KAIT20 default component inserts resolve classifier IDs with a
code lookup, so they reference the pre-existing row in the collision case.

There is deliberately no fuzzy or display-name matching. Classifier code remains
the canonical machine identity.

The representative pre-016 MySQL test supplies custom-ID/custom-name `SPECTATOR`
and `GRAND_PRIX` rows. Migration succeeds, preserves both IDs/names, and wires the
policy values `0.5000` and `10.0000` to those rows.

## Snapshot and status boundaries

Naive MySQL Event timestamps are interpreted as documented UTC and serialized as
`YYYY-MM-DDTHH:mm:ssZ`. A timezone-aware value is normalized to UTC. The contract
requires the `Z` suffix rather than accepting an arbitrary offset.

Person Status boundaries are DATE-based and exclusive:

- already active + retired today → tomorrow;
- future + cancelled before start → `valid_from` (empty effective interval);
- naturally ended earlier → `valid_to + 1`, never extended by retirement.

## Tests and checks actually run

Commands were run from the repository root.

- `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_platform_structure.py::test_legacy_upgrade_preserves_membership_and_score_attribution backend/tests/test_scoring_v2.py::test_v2_activation_cannot_cross_existing_v1_award backend/tests/test_scoring_v2.py::test_historical_engine_activation_boundary_preserves_v1 backend/tests/test_scoring_v2.py::test_reversed_v1_award_remains_in_newcomer_baseline backend/tests/test_scoring_v2.py::test_newcomer_concurrency_and_reversal_stability backend/tests/test_scoring_v2.py::test_existing_history_sets_newcomer_baseline backend/tests/test_scoring_v2.py::test_no_rule_does_not_consume_newcomer_sequence backend/tests/test_scoring_v2.py::test_inactive_status_type_preserves_historical_scoring backend/tests/test_scoring_v2.py::test_person_status_retirement_is_historical_and_overlap_safe backend/tests/test_scoring_v2.py::test_status_retirement_boundary_preserves_the_current_moscow_day backend/tests/test_scoring_v2.py::test_preview_production_parity_and_published_immutability -x`
  → **11 passed, 1 warning in 23.66s**.
- `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_scoring_v2.py -x`
  → **39 passed, 1 warning in 16.11s**. This was the single allowed complete
  Scoring v2 run because both central newcomer reconstruction and migration 016
  changed. It was not repeated.
- `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_platform_structure.py::test_legacy_upgrade_preserves_membership_and_score_attribution -x`
  → **1 passed, 1 warning in 15.14s** after the final assertion expansion for
  collision-resolved component values.
- `backend\.venv\Scripts\python.exe -m ruff check backend/src/event_api/scoring_v2.py backend/src/event_api/routers/scoring_v2.py backend/tests/test_scoring_v2.py backend/tests/test_platform_structure.py`
  → **All checks passed**.
- `backend\.venv\Scripts\python.exe -m ruff format --check backend/src/event_api/scoring_v2.py backend/src/event_api/routers/scoring_v2.py backend/tests/test_scoring_v2.py backend/tests/test_platform_structure.py`
  → **4 files already formatted**.
- `backend\.venv\Scripts\python.exe -m mypy backend/src/event_api/scoring_v2.py backend/src/event_api/routers/scoring_v2.py`
  → **Success: no issues found in 2 source files**.
- `pnpm --filter @event-registration/contracts typecheck`
  → **passed**.
- `pnpm --filter @event-registration/contracts test`
  → **1 file passed, 13 tests passed**.
- `pnpm format:check`
  → **passed**.
- `git diff --check`
  → **passed**.
- migration immutability check against
  `6c98992ba403f15d1a507e4c457402bce3290c0d`
  → **migrations 001–015 unchanged**.
- `git apply --check --reverse CODEX_REVIEW.patch`
  → **passed**.

An initial targeted run stopped after **8 passed, 1 failed** because the new
inactive-classifier test left its seed row inactive for the next test in the shared
test database. The test now restores seed state; the unchanged production behavior
then passed the final 11-test targeted run and 39-test Scoring v2 run above.

The warning in Python runs is the existing Starlette deprecation notice about the
test client package; it is unrelated to this correction.

## NOT RUN TO SAVE RESOURCES

As required, the following were not rerun: full Activity suite (previously 17/17
and Activity code was not changed by this micro-fix), full backend regression,
full repository `pnpm test`, Scanner, browser E2E, load tests, production build,
dependency audit, release packaging, SMTP, production DB rehearsal and deployment.

The pre-existing Web fixture debt around missing Event `organizationId` remains
outside this backend correction.

## Deviations and remaining risk

No product or architecture deviation. The same ScoringPolicy, Decimal, locking,
snapshot, exact reversal, preview, membership and organization-scope designs are
retained. The exact-code seed strategy intentionally preserves a pre-existing
display name rather than silently canonicalizing user data.

Production reconciliation counts unknown. No production database was used.

## Final gate

Findings 1–5 are FIXED and their targeted real-MySQL tests are green. Findings 6–7
are also FIXED. Existing v1 history cannot be split across engines, non-engine
ledger rows are not mislabeled, cancelled historical Participation retains its
sequence position, inactive classifiers cannot erase historical scores, and seed
collisions resolve safely.

**STAGE 2 READY FOR FINAL ACCEPTANCE**
