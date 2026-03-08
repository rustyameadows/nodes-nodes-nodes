# Product Brief: Node Interface Demo

## Problem
Creative model workflows are scattered across provider UIs and disconnected review tools. Users lose context when they move from prompt-building to generation to comparison.

## Product
Ship a local-first desktop app where one person can:
- manage multiple isolated projects
- build generation workflows on an infinite canvas
- run OpenAI and Topaz jobs through one interface
- review visual outputs quickly in a comparison-oriented asset viewer

## Product Form
- Electron desktop app
- local SQLite metadata
- local asset and preview storage
- one open workspace at a time
- app-level home screen for project creation and project picking

## Core User Flows
1. Start on app home and create or reopen a project.
2. Land on an empty or previously saved canvas for that project.
3. Add text notes, models, list nodes, text templates, or asset pointers.
4. Connect nodes and run a model node.
5. Watch queue state and inspect the exact provider call.
6. Review outputs in grid, 2-up, or 4-up modes.
7. Rate, flag, tag, and filter assets.
8. Return to app home and switch projects cleanly.

## In Scope
- Single local user
- Project create/rename/archive/unarchive/delete
- One canvas per project
- Durable local job execution
- Provider/model registry with stable IDs
- OpenAI image generation
- OpenAI GPT text generation as note-native outputs
- Topaz image transforms
- Asset import, viewing, tagging, rating, and filtering
- Existing color system and canvas semantic colors

## Out of Scope
- Accounts, orgs, or sharing
- Hosted deployment hardening
- Billing or usage metering
- Data migration from the old Postgres app
- Exact pixel parity with the old Next.js shell

## Success Criteria
- `npm run dev` launches the desktop app locally without Postgres.
- Projects switch cleanly with isolated canvas and asset state.
- Jobs survive app restarts and recover deterministically.
- The asset viewer stays fast and predictable for typical local project sizes.
- Renderer code never receives raw API keys or filesystem paths.
