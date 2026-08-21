# ADR-003 — Scanner as PWA

Status: **Accepted**

## Context
Scanner используется на обычных iPhone/Android, должен работать с камерой и offline cache. App Store/Google Play публикация создаёт лишнюю стоимость и задержки.

## Decision
Отдельное устанавливаемое PWA на React/Vite с IndexedDB.

## Consequences
- не планировать обязательный App Store release;
- service worker/offline lifecycle тестируется отдельно;
- PWA имеет отдельный frontend lifecycle от admin/public web.
