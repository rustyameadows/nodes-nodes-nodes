# Decisions Log

## 2026-03-04 - Local-First Architecture
- Decision: prioritize local runtime over hosted-first design.
- Rationale: optimize iteration speed and developer onboarding for demo quality.
- Consequence: local Postgres and filesystem storage are first-class from day one.

## 2026-03-04 - V1 Scope Is Single User
- Decision: defer accounts, orgs, and sharing.
- Rationale: focus on product core loop (project -> canvas -> generation -> asset curation).
- Consequence: ownership and permissions are intentionally absent in initial schema.

## 2026-03-04 - Projects Are First-Class in V1
- Decision: support multiple local projects with one open workspace at a time.
- Rationale: users need isolated experiments and rapid switching.
- Consequence: explicit project lifecycle and workspace persistence required.

## 2026-03-04 - One Canvas per Project (V1)
- Decision: constrain each project to exactly one infinite canvas initially.
- Rationale: reduces complexity while preserving project isolation.
- Consequence: future multi-canvas support will require schema and UX expansion.

## 2026-03-04 - Provider-Agnostic Node System
- Decision: all provider nodes share one contract and equal treatment.
- Rationale: avoid provider lock-in and simplify expansion.
- Consequence: provider adapters must normalize request/response behavior.

## 2026-03-04 - Canonical Provider Set
- Decision: include OpenAI, Gemini 3.1 Flash, and Topaz in v1 docs.
- Rationale: cover text/image/video generation and enhancement scenarios.
- Consequence: model registry must map stable IDs to mutable display names.

## 2026-03-04 - Gemini Display Name Override
- Decision: expose Gemini 3.1 Flash as `Nano Banana 2` in UI.
- Rationale: product language can differ from backend model IDs.
- Consequence: display labels are lookup-driven, never persisted as primary IDs.

## 2026-03-04 - Queue Backend Is Postgres (`pg-boss`)
- Decision: use `pg-boss` for async orchestration.
- Rationale: same backend works locally and in deployment with Postgres.
- Consequence: no Redis dependency in v1.

## 2026-03-04 - Storage Adapter Uses Local Filesystem in V1
- Decision: generated binaries are stored on disk behind a storage abstraction.
- Rationale: simple local-first behavior with easy migration path later.
- Consequence: object storage adapter can be introduced without rewriting business logic.
