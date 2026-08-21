# 08. Offline Scanner & Synchronization

Статус: **Approved protocol baseline — v0.2**

## 1. Guaranteed offline scope

MVP guarantees that after successful preparation SCANNER can without internet:
- open the assigned prepared Event;
- resolve QR for registrations present in the downloaded bundle;
- see minimum participant data;
- search cached participants;
- create pending AttendanceEvent records;
- recognize locally known already-attended state.

MVP does **not** guarantee creation of a brand-new onsite Registration while fully offline. New onsite participant creation requires API access because deduplication and capacity are server invariants.

## 2. Local storage

IndexedDB through Dexie.

Local tables conceptually:
- `prepared_events`;
- `offline_registrations`;
- `pending_attendance`;
- `sync_state`;
- optional device metadata.

Stored participant fields:
- registrationId;
- QR payload hash/lookup value;
- ФИО;
- группа;
- статус;
- организация;
- телефон;
- firstAttendedAt.

Do not cache birth date, email or custom answers unless a future approved use case requires them.

## 3. QR offline lookup

Server QR payload is `publicId.signature`. Scanner never receives QR signing secret.

Offline bundle contains a cryptographic hash of the expected QR payload associated with registrationId. On scan, PWA hashes scanned payload and performs local lookup.

Online scanner uses `POST /scanner/events/:eventId/resolve-qr`.

## 4. Preparation

After Event selection, while online:
1. verify current staff session and EventAccess;
2. request bundle metadata/version;
3. download full bundle;
4. write new bundle to IndexedDB transactionally;
5. verify row count/checksum/basic integrity;
6. atomically mark prepared version active;
7. show `Готово к офлайн-работе`.

A partial download must never replace the previously usable bundle.

## 5. Bundle version

Event has monotonic `offline_data_version`.

Increase version for changes that affect scanner dataset, e.g.:
- new/annulled Registration;
- changes to scanner-visible snapshot fields;
- attendance state synchronized from server.

At 100–1000 registrations, MVP downloads a full replacement bundle when version differs. No differential sync.

## 6. Offline access lifecycle

Prepared data was obtained after authenticated authorization. While disconnected, backend cannot instantly revoke access already cached on the device; this is an explicit MVP limitation.

Controls:
- logout immediately clears all offline business data;
- automatic cache expiry default: 24h after Event `end_at`;
- reconnect revalidates session/EventAccess before refreshing bundle or syncing new activity;
- deactivated staff cannot sync or download after reconnect.

Do not claim browser storage is secure against a person who controls/unlocks the device. Risk is reduced through data minimization and short retention.

## 7. Pending attendance

Every local attendance action is assigned `client_event_id UUID` before network transmission and persisted transactionally.

Status locally:
- `PENDING`;
- `SYNCING`;
- `CONFIRMED` (then removable from pending store);
- `REJECTED` requiring visible resolution.

## 8. Reconnect order

1. Revalidate session/access.
2. Submit pending attendance batch.
3. Apply per-item server results.
4. Remove only confirmed/idempotently processed items.
5. Keep rejected items with error state for operator visibility.
6. Check server `offline_data_version`.
7. Download and transactionally swap bundle if stale.

Pending events are never erased merely because a bundle refresh starts.

## 9. Multiple devices

No distributed locking between phones.

If two devices scan the same participant while disconnected, both local events can exist. Server accepts idempotent client event IDs and determines first valid attendance. Later event is marked repeated/duplicate but retained according to attendance/audit policy.

## 10. Time

Store:
- `device_scanned_at`;
- last known device-to-server clock offset/measurement metadata;
- `estimated_scanned_at`;
- server `received_at`.

Use server-adjusted estimate for arrival analytics when credible. Received time remains available for diagnostics. Absurd clock offsets must not silently rewrite event history; implementation can clamp/flag suspicious values.

## 11. Offline UX states

Required:
- `ONLINE / синхронизировано`;
- `OFFLINE READY`;
- `OFFLINE / N ожидают синхронизации`;
- `SYNCING`;
- `OFFLINE DATA OUTDATED`;
- `SYNC ERROR`;
- `ACCESS REVALIDATION REQUIRED`.

## 12. Service worker update safety

PWA application-shell updates must not delete pending attendance. Schema migrations for IndexedDB must be backward-safe and tested. A new release cannot force-clear local business data just to fix cache issues.
