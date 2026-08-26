# 18. Codex Development Workflow

Статус: **Approved baseline**

## 1. Principle

Codex receives bounded engineering tasks against documented contracts; it is not asked to invent product behavior from scratch.

Current OpenAI model guidance favors lean instructions: state rules once, expose only relevant tools/context, and keep reusable policy in one place. Root `AGENTS.md` is therefore concise and points to canonical docs instead of duplicating the full product spec.

## 2. Task format

Every substantial task should state:

- Goal
- Allowed scope/files
- Relevant docs/contracts
- Requirements/invariants
- Acceptance criteria
- Required tests
- Explicit non-goals

## 3. Work decomposition

Good parallel workstreams only after interfaces are fixed, e.g.:
- database schema/migrations;
- contracts;
- API module;
- web UI consuming an already-defined contract;
- scanner local DB/sync;
- tests/review.

Do not parallelize two agents that both need to invent the same contract.

## 4. Change discipline

Codex should:
1. read `AGENTS.md` and relevant docs;
2. inspect existing code before editing;
3. make the smallest coherent change;
4. run targeted checks during implementation;
5. run full project checks before handoff when feasible;
6. summarize changed files, tests and remaining risks.

## 5. Architecture changes

A task must not silently replace MySQL 8.1.0, the approved deployment direction, PWA scanner, modular monolith, React/Vite or NestJS. Architecture changes require an updated ADR and explicit owner approval.

## 6. Documentation as code

When behavior changes, update the narrowest canonical doc in the same change. Do not leave implementation and docs knowingly contradictory.

## 7. Codex model selection

Use the strongest available Codex/agent configuration for architecture, concurrency, security and offline-sync work; cheaper/faster configurations are suitable for repetitive isolated tasks after contracts are fixed. Model names change over time, so repository policy should not hard-code a deprecated model as a product dependency.

## 8. Review tasks

Use separate review passes for:
- correctness against product spec;
- security/privacy;
- concurrency/idempotency;
- offline behavior;
- UI/design-system adherence.

A reviewing agent should not automatically rewrite broad areas unless the review task explicitly permits fixes.
