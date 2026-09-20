# MosActive Stage 1 — Platform Structure Foundation

## Current deployment model

Stage 1 follows **KAIT20-first** product scope. The current application serves one
Tenant and one Organization: **КАИТ №20**. Existing Event KAIT20 records, future
MosActive records, six departments, study groups, students and staff are placed
in that trusted server-side context.

Canonical KAIT20 Departments are: Датахаб, Кибер, АртТех, МосСовет, Техно and
Диджитал. Migration 015 maps only the approved legacy aliases (including Data
Hub, Артех, Моссовет and Digital) to these records using trimmed,
case-insensitive exact matching. Unknown values remain losslessly represented by
`LEGACY_*` Departments.

The browser does not select Tenant or Organization. Authenticated staff context
comes from the session; new structure records and Events use its current KAIT20
Organization. A compatibility `organizationId`, when supplied to a structure
write, must match that current Organization or the request is rejected.

## Architectural model

The schema is **replication-ready**, not a multi-organization SaaS runtime.
Tenant/Organization boundaries are retained so the Activity and future Scoring
core can later be adapted for another educational organization without being
rewritten. Person is a Tenant-level canonical identity; Department, StudyGroup,
Event and StudentMembership belong to Organization. ActivityDirection supports
organization-local and future tenant-global scope, while current API creates
only KAIT20-local directions.

Required scope columns are `NOT NULL` after legacy backfill and have no permanent
KAIT20 database default. Application, bootstrap and seed writes must provide
trusted scope explicitly. Authentication/current-session access requires active
Staff, Tenant and Organization.

## Migration and historical data

Additive migration `015_platform_structure.sql` creates `tenants`,
`organizations`, `departments`, `study_groups` and `activity_directions`; adds
scope relations to existing entities; and extends `student_memberships` with
normalized IDs and a historical course snapshot. Backfill assigns legacy rows
to KAIT20 without changing Person, Event, StudentMembership or ScoreTransaction
IDs and without changing `score_transactions.membership_id`.

Exact non-empty legacy department/group/direction strings are reconciled without
fuzzy matching. A known Department alias changes only the normalized
`department_id`; the historical `student_memberships.department` snapshot is not
rewritten. Course is never parsed from a group name. Values that cannot be
proved remain nullable. Membership reads use historical `study_group`,
`department` and `course` snapshots, with nullable normalized IDs, so unresolved
legacy history remains visible and later directory renames do not rewrite the
Digital Dossier.

Legacy reconciliation counts are available through the non-PII helper
`backend/src/event_api/structure_diagnostics.py`. It reports membership totals,
normalization gaps, normalized StudyGroups, distinct Person/Registration legacy
group values and unmatched legacy values. These diagnostics support review and a
future controlled reconciliation; they do not guess Department or course.

## Compatibility

Person/Registration organization and group snapshots, StudentMembership group
and department snapshots, and Event `direction` text remain for existing
consumers. For new Events, `direction_id` is canonical and the compatibility text
is synchronized. Inactive directions are rejected through both canonical ID and
legacy text paths. Direction code and name are unique inside an exact scope. If
a legacy name resolves to more than one effective Direction (for example local
plus tenant-global), the request returns `DIRECTION_AMBIGUOUS` instead of choosing
an arbitrary row.

Global staff email and Event slug uniqueness remain unchanged. Public routes use
the KAIT20 compatibility context. **Public tenant/organization resolution is
deferred until replication/multi-organization deployment is required.**

## Not implemented yet

The following are consciously deferred and are not Stage 1 defects:

- multi-organization production operation;
- Platform Admin and tenant provisioning;
- organization switching or a frontend selector;
- tenant domains, subdomains or organization-specific authentication portals;
- full cross-organization authorization hardening for Event, Registration,
  Person, Staff and Scanner workflows;
- billing or SaaS management;
- MosActive frontend and Student Cabinet;
- Scoring Engine v2.

Before Stage 2, Season, EventCategory, EventLevel, ParticipationRole and
ParticipationResult must be reviewed as KAIT20 configuration today and
replication-ready configuration tomorrow. Scoring classifiers must not be
hardcoded in application code. Stage 2 must not be inferred as implemented by
this foundation.
