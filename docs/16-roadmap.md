# 16. Roadmap

Статус: **Version 1.0 complete; version 2.0 scope recorded**

## MVP v1

Обязательно:
- SUPER_ADMIN;
- SCANNER invitations/auth;
- Event CRUD;
- configurable form;
- consent checkbox;
- public registration;
- capacity;
- Person deduplication;
- Registration-specific QR;
- ticket email;
- ticket page;
- participant list/search;
- manual/fast scan;
- offline PWA;
- onsite registration;
- Excel import/export;
- basic statistics;
- minimal audit log;
- staging/production;
- backups.

## Version 2.0 — committed feature

**Mass email broadcasts to participants of a selected Event.**

Use cases:
- перенос;
- изменение места;
- изменение времени;
- организационные сообщения;
- объявления.

Необходимо использовать уже существующие Registration recipients, Email Service и queue.

## Future candidates, not committed to 2.0

- automatic reminders;
- EVENT_ADMIN;
- waitlist;
- richer analytics;
- entry/exit and zones;
- additional form field types;
- offline creation of brand-new onsite participants (only if operationally needed);
- integrations with other college systems;
- controlled anonymization/data retention tools.

## Explicit non-goal

Scanner остаётся PWA. Релиз через App Store не является целевым направлением проекта.
