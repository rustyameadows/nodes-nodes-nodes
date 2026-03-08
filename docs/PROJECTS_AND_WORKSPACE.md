# Projects and Workspace (Desktop V1)

## Objective
Support multiple local projects with strict isolation and exactly one open workspace at a time.

## Project Lifecycle
- Create
  - inserts `projects`, `project_workspace_states`, and `canvases`
  - first project becomes the open workspace automatically
- Rename
  - updates `projects.name`
- Archive / unarchive
  - toggles `projects.status`
- Open
  - closes the previously open workspace and marks the new one open
  - updates `last_opened_at`
- Delete
  - removes project rows and related app-data asset/preview folders

## Workspace Rules
- Only one project can be open at a time.
- Opening a project does not merge state from any other project.
- Startup always lands on app home at `/`.
- App home shows a create-project panel, active project cards, and a separate archived-project section when archived projects exist.
- The native macOS `Project` menu mirrors the in-canvas `Menu` pill for view switching and project switching.
- `Home` is available from the in-canvas `Menu` pill, app settings, and the native macOS `Project` menu.
- Native project switching preserves the current workspace view when that view is project-scoped.

## Persisted State
- Canvas document
- Canvas viewport inside that document
- Asset viewer layout
- Asset viewer filters
- Open-project marker
- Provider credentials are not project data; they are app-level settings shared across projects

Current selection is treated as local UI state, not durable cross-restart state.

## Isolation Guarantees
- Jobs are always project-scoped.
- Assets, feedback, tags, and previews are always project-scoped.
- Canvas asset pointers may reference existing project assets, but never assets from another project.
- Default queries never cross project boundaries.

## Delete Behavior
Deleting a project removes:
- project metadata
- workspace state
- canvas document
- jobs and attempts
- assets and feedback
- tags and tag links
- preview-frame metadata
- stored asset files under `assets/<projectId>`
- stored preview files for the project’s jobs

## Startup Behavior
1. Desktop runtime initializes SQLite and provider metadata.
2. Renderer requests projects.
3. Renderer routes to app home at `/`.
4. App home shows any existing projects and lets the user create or open a project.
5. Opening a project routes to that project's canvas.
