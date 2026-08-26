# 17. Engineering Review v0.2

Статус: **Completed — 21 August 2026**

## Purpose

Review Documentation v0.1 for contradictions and unresolved implementation blockers before repository scaffold.

## Decisions closed

### 1. Dynamic answers
Changed from ambiguous `registrations.custom_answers JSON` vs separate entity to explicit `registration_answers` table. Each answer stores field label/type snapshot plus typed JSON value.

### 2. Capacity
Only ACTIVE Registration counts. ANNULLED frees capacity. Normal public/onsite operations cannot exceed capacity. Only SUPER_ADMIN may explicitly overbook; SCANNER cannot.

### 3. Onsite offline boundary
New onsite participant creation is online-only in MVP because server must enforce deduplication and capacity. Offline scope remains strong for prepared participants and attendance.

### 4. Online QR resolution
Added `POST /scanner/events/:eventId/resolve-qr`. Secret QR payload is sent in POST body instead of URL.

### 5. Invitation acceptance
Added missing `POST /auth/invitations/:token/accept`.

### 6. Person directory
Added simple SUPER_ADMIN global People directory because owner requires access to the common participant database, not only per-Event lists.

### 7. Deduplication
Made matching conservative and deterministic. FIO alone never merges. Excel medium-confidence matches require preview/admin decision.

### 8. Offline authorization limitation
Documented that already-downloaded browser data cannot be instantly revoked while device is truly offline. Mitigation: minimal fields, logout clear, expiry, revalidation on reconnect.

### 9. Email idempotency
Added delivery idempotency key and requirement for post-commit reliable enqueue/outbox-equivalent behavior.

### 10. Security
Added explicit CSRF/CORS/session/logging/XLSX requirements and production security gate.

## Remaining non-blocking external inputs

- final legal consent URL/text version;
- official logo asset used in implementation;
- final product name;
- domain/subdomains;
- email provider and server credentials configured as secrets;
- exact Yandex Cloud sizing/budget.

None blocks repository scaffold or core domain implementation.

## Ready gate

Project is ready for scaffold when root `AGENTS.md` accompanies this documentation and the initial repository uses the documented stack without introducing alternative frameworks/services.
