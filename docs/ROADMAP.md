# Roadmap

## Milestone 0: Documentation Baseline (Completed)
- product, architecture, data model, provider, workspace, UX, and decision docs established

## Milestone 1: Local App Foundation (Completed, Superseded)
- initial Next.js + Postgres + Prisma scaffold

## Milestone 2: Project and Workspace Core (Completed)
- project lifecycle
- one-open-project behavior
- workspace restore

## Milestone 3: Canvas and Execution Pipeline (Completed)
- custom infinite canvas
- node persistence
- provider job lifecycle

## Milestone 4: Provider Integrations (Completed)
- OpenAI image
- OpenAI GPT text
- Topaz image transforms
- provider/model registry

## Milestone 5: Asset Review Surface (Completed)
- grid
- 2-up and 4-up compare
- rating, flagging, tags, filtering

## Milestone 6: Desktop Migration (Completed)
- Electron main/preload/worker split
- Vite renderer
- TanStack Router and Query foundation
- SQLite + Drizzle persistence
- SQLite-backed durable queue
- native file import and `app-asset://` delivery

## Milestone 7: Mac Packaging and Credentials (Completed)
- unsigned Apple Silicon `.app` and `.zip` packaging via `electron-builder`
- packaged-app icon and branding metadata
- macOS Keychain-backed provider credentials with env fallback
- packaged-app verification commands and lifecycle documentation

## Next
- broader automated test coverage for desktop flows
- queue cancellation / richer controls
- additional node types and execution surfaces
- signed / distributable mac release artifacts
