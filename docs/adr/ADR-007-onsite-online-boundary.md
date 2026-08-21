# ADR-007 — New onsite registrations require online API in MVP

Status: **Accepted**

## Decision
Offline scanner supports prepared registrations and attendance. Creating a brand-new onsite participant/Registration requires network access to API in MVP.

## Why
Server must enforce Person deduplication, active-registration uniqueness and Event capacity across multiple devices. Allowing offline creation would require a substantially more complex distributed conflict model.

## Future
Offline walk-in creation may be reconsidered if real event operations prove it necessary.
