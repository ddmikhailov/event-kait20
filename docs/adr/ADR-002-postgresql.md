# ADR-002 — PostgreSQL as source of truth

Status: **Superseded by ADR-008**

## Context
Нужны транзакционные capacity checks, уникальные constraints, несколько scanners, offline synchronization, роли, audit и история посещений.

## Decision
Историческое решение: использовать PostgreSQL. Оно заменено явным решением владельца перейти на MySQL 8.1.0; Google Sheets/Яндекс Таблицы по-прежнему не являются основной БД.

## Consequences
Excel/таблицы используются только как импорт/экспорт или дополнительное представление данных.
