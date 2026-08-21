# ADR-006 — Registration answers as rows

Status: **Accepted**

## Decision
Store dynamic participant answers in `registration_answers` rather than one `registrations.custom_answers` JSONB object.

## Why
- preserves a stable relation to each form field;
- supports field label/type snapshots;
- simpler historical export and validation;
- avoids rewriting one opaque JSON document for individual answer changes.

The answer value itself may be JSON typed value (string/boolean/string array).
