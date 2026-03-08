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
- Startup restores the currently open project when available.
- If no project exists, the launcher is shown.
- The native macOS `Project` menu mirrors the in-canvas `Menu` pill for view switching and project switching.
- Native project switching preserves the current workspace view when that view is project-scoped.

## Persisted State
- Canvas document
- Canvas viewport inside that document
- Asset viewer layout
- Asset viewer filters
- Open-project marker

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
3. If an open or last-active project exists, the app routes to that project canvas.
4. Otherwise the launcher is shown.
