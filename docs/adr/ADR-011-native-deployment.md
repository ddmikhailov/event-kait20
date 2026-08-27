# ADR-011 — Native deployment without Docker

Статус: **Superseded by ADR-012**  
Дата: 2026-08-26

## Контекст

Организационный сервер должен запускать платформу без Docker. При этом нельзя
менять MySQL 8.1.0, Python/FastAPI backend, React/Vite clients или ослаблять
изоляцию production-сервисов.

## Решение

- MySQL ровно 8.1.0 устанавливается официальным native binary и слушает loopback;
- API и email worker работают как отдельные hardening-enabled systemd services;
- Nginx завершает TLS и раздаёт Web/Scanner production artifacts;
- локальный demo управляет нативными процессами одной foreground-командой;
- CI использует checksum-pinned официальный пакет MySQL 8.1.0 без container;
- Docker/Compose files удаляются, чтобы не поддерживать второй deployment path.

## Исторические последствия

Docker больше не является runtime, local-demo или CI prerequisite. Обновления
требуют пересобрать static artifacts и Python environment из одного commit.
Операционная команда отвечает за systemd, Nginx, TLS, native MySQL backup и
проверку точной версии. Риск завершившегося lifecycle MySQL 8.1.0 сохраняется и
компенсируется изоляцией, минимальными правами и recovery controls.

Эти Nginx/systemd decisions больше не являются инструкцией Release 1.0 и не
входят в package системного администратора. Текущий contract определён ADR-012.
