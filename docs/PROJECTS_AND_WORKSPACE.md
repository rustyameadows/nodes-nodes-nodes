# Projects and Workspace (V1)

## Objective
Support multiple local projects with isolated state and simple switching. Each project owns exactly one infinite canvas.

## Project Lifecycle
- Create project:
  - Required: `name`.
  - Side effects: create `projects`, `canvases`, and `project_workspace_states` rows.
- Rename project:
  - Updates `projects.name`.
- Archive project:
  - Sets `projects.status = archived`.
  - Excluded from default active list.
- Unarchive project:
  - Sets `projects.status = active`.
- Delete project:
  - Permanently removes project and all related canvas, jobs, assets, tags, and workspace state.

## Sidebar UX Rules
- Always visible in app shell.
- Shows active projects by default.
- Archived section collapsible/expandable.
- Actions per project row: rename, archive/unarchive, delete.
- Primary action: open project.

## Open/Close Semantics
- Exactly one project may be open at any time.
- Opening project `B` while `A` is open:
  1. Save workspace state for `A`.
  2. Mark `A` as not open.
  3. Mark `B` as open.
  4. Load `B` canvas and viewer state.
- Explicit close action:
  - Marks current project as not open.
  - Returns to project launcher/empty workspace screen.

## Startup Restore
- On app start:
  1. Query last-opened active project.
  2. Restore open workspace and associated state.
  3. If no prior project exists, show launcher with create action.

## Workspace State Persistence
- Persist per project:
  - canvas viewport
  - current node/asset selection
  - asset viewer mode
  - filter/sort settings
- Save on:
  - project switch
  - workspace close
  - periodic debounce while active

## Isolation Guarantees
- Jobs and assets are always project-scoped.
- Canvas nodes/edges are project-scoped.
- Tags and rating/flag metadata are project-scoped.
- No cross-project reads in default queries.

## Error and Edge Cases
- Deleted active project:
  - auto-close workspace and return to launcher.
- Opening archived project directly:
  - allow open if explicitly selected from archived list.
- Corrupt/missing workspace state:
  - fall back to defaults without blocking project open.

## Acceptance Criteria
1. User can create 3+ projects and switch with isolated state.
2. Open project state is restored after app restart.
3. Asset filters in one project do not affect others.
4. Delete and archive operations behave predictably and are reversible only where intended.
