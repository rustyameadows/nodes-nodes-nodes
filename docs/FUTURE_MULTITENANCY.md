# Future Multitenancy Plan (Deferred Beyond V1)

## Purpose
Define how the local single-user design can evolve to accounts, orgs, and shared projects without breaking existing local workflows.

## Future Scope
- User authentication and session management.
- Organizations and membership roles.
- Project ownership by user or org.
- Project sharing across users/orgs with role-based access.

## Proposed Ownership Model
- `projects.owner_type`: `user` or `org`
- `projects.owner_id`: foreign key to owner entity
- Share table grants additional access:
  - `viewer`
  - `editor`
  - `owner` (for explicit transfer/override flows)

## Proposed Additional Tables
- `users`
- `orgs`
- `org_memberships`
- `project_shares`
- `audit_events` (recommended for access and destructive actions)

## Migration Strategy from V1
1. Introduce `users` table and create a synthetic local default user.
2. Add owner columns to `projects`.
3. Backfill all existing projects to synthetic local user ownership.
4. Introduce optional auth flow and user switch capability.
5. Enable org membership and project sharing flows.
6. Tighten query filters and authorization middleware.

## Compatibility Rules
- Keep existing project IDs stable.
- Preserve project-level isolation semantics.
- Preserve provider and model IDs.
- Do not invalidate existing asset storage refs.

## Security and Access Considerations
- Require authorization checks on every project, canvas, job, and asset endpoint.
- Add row-level visibility constraints at data access layer.
- Track role changes and destructive operations in audit log.

## Deferred UX Decisions
- Realtime collaborative canvas editing.
- Share invitation and acceptance workflow.
- Conflict resolution for simultaneous edits.

## Readiness Triggers
Begin multitenancy implementation only after:
1. Local single-user workflow is stable and tested.
2. Provider adapters are reliable under normal usage.
3. Asset viewer curation UX is validated.
