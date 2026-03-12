# Design System

## Goal
Unify the desktop app around shared foundations while letting the canvas keep its own visual language.

## Surface Model
- `app`
  - light, high-clarity shell for app home, Node Library, settings, assets, queue, and asset detail
  - uses warm white surfaces with citrus/aqua accent echoes from the canvas palette
- `canvas-overlay`
  - dark floating chrome for the workspace menu, insert picker, bottom tray popovers, asset picker modal, and selection action strip
  - keeps the overlay language aligned with the black canvas
- `canvas-node`
  - a sibling token/recipe layer for node cards on the black canvas
  - reuses spacing, radius, motion, typography, and focus foundations from the main design system
  - does not inherit the light app-shell surface language

Protected areas:
- main project canvas connections
- the black canvas background treatment itself

Allowed wrapper changes around protected areas:
- page framing
- shell/menu chrome
- insert/context menus
- bottom-center canvas selection rail
- Node Library detail rails and canvas frame

Canvas node renderers are now part of the system:
- shared node tokens live under `src/styles/design-system/nodes/`
- shared node chrome lives under `src/components/canvas-nodes/`
- the Node Library playground intentionally reuses the same node renderer path as the project canvas

## Token Layers
Source files live under `src/styles/design-system/`.

1. Primitive tokens
- raw color palette
- spacing scale
- radii
- shadows
- motion/easing
- typography
- z-index

2. Semantic tokens
- page wash and surfaces
- text and border roles
- focus ring
- control backgrounds
- app vs canvas-overlay surface values
- state colors for success, warning, danger, info, accent, neutral

3. Component tokens
- button padding
- panel padding and radius
- popover and modal radius
- shell/menu/queue radii
- node rails, badges, checkerboard, hotspot sizes, and canvas accent recipes
- canvas-node border recipes keep the preserved semantic palette, with left-edge accents driven by connected input semantics and right-edge accents driven by node/output semantics

Rule:
- CSS Modules and component styles consume semantic/component variables.
- Primitive values stay in the token layer.
- View-level overrides can deliberately force square corners for tool surfaces like asset review without rewriting the shared radius tokens globally.

## Density
- `comfortable`
  - home, settings, Node Library wrappers
- `compact`
  - assets controls, queue tables/inspector, canvas overlays

Density is a design-system implementation detail in this pass. There is no user-facing density toggle yet.

## Shared Primitives
Shared UI primitives live in `src/components/ui/`.

Available primitives:
- `Button`
- `Panel` / `Card`
- `Field`
- `Input`
- `Textarea`
- `SelectField`
- `Badge`
- `SectionHeader`
- `EmptyState`
- `ToolbarGroup`
- `PopoverSurface`
- `ModalSurface`

Usage rules:
- migrated route surfaces should prefer these primitives over route-local button/input/panel styling
- route CSS should handle layout and page-specific composition, not reinvent control chrome
- overlay shells should use `canvas-overlay` data attributes when they render outside the normal tree

## Canvas Node System
Shared node primitives:
- `NodeFrame`
- `NodeTitleRail`
- `NodeTopUtilities`
- `NodeFooterRail`
- `NodeActionRail`
- `NodeResizeHotspot`

Usage rules:
- keep the semantic canvas palette stable; node-system work should normalize reuse, not repaint node types
- node chrome should route through explicit external slots:
  - centered title rail
  - top-right utility slot
  - bottom caption/action rail
- image nodes keep the media surface free of labels, badges, and handles; that chrome belongs in the external slots
- template preview pills belong inline in the preview copy, not in a second shelf below the note body
- list add/remove/resize affordances should overlay the grid instead of consuming table layout
- active/edit behavior is derived in `src/lib/canvas-node-presentation.ts`, not redefined ad hoc in each node renderer
- node action buttons should come from shared action descriptors in `src/lib/canvas-node-actions.ts`

## Motion and Accessibility
- micro feedback: `140ms`
- UI transitions: `180ms`
- layout shifts: `240ms`
- focus-visible always uses the semantic focus ring
- disabled controls reduce opacity and remove pointer affordance
- global reduced-motion fallback collapses animations/transitions

## Guardrail
- Run `npm run check:design-system`.
- The check rejects raw color literals in design-system-managed files and migrated UI modules.
- Token files are exempt because they are the source of truth for raw values.

## UI PR Checklist
- Uses semantic/component vars instead of raw colors in migrated UI files
- Uses shared primitives for route-level controls and panels where applicable
- Keeps the black canvas background and semantic connection/node palette intact
- Routes node-card changes through the shared canvas-node system instead of one-off per-node CSS
- Preserves keyboard/accessibility behavior
- Verifies light app surfaces and dark canvas overlays both still read clearly
