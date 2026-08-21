# ADR-002 — PostgreSQL as source of truth

Status: **Accepted**

## Context
Нужны транзакционные capacity checks, уникальные constraints, несколько scanners, offline synchronization, роли, audit и история посещений.

## Decision
Использовать PostgreSQL. Google Sheets/Яндекс Таблицы не являются основной БД.

## Consequences
Excel/таблицы используются только как импорт/экспорт или дополнительное представление данных.
