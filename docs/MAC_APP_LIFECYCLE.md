# Mac App Lifecycle

## Goal
Produce a local unsigned Apple Silicon macOS app bundle, verify it, open it from Finder, configure provider credentials in-app, and confirm the packaged app is usable without source-run tooling.

## Prerequisites
- macOS on Apple Silicon
- repo dependencies installed with `npm install`
- provider keys available for any real model runs you want to test

Optional for source-run development:

```bash
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
TOPAZ_API_KEY=...
```

For the packaged app, those keys can also be entered from App Settings and stored in the macOS Keychain.

## Build And Package
Create the local unsigned `.app` and `.zip`:

```bash
npm run package:mac
```

Expected artifacts:
- `release/mac-arm64/Nodes Nodes Nodes.app`
- `release/Nodes Nodes Nodes-<version>-arm64-mac.zip`
- `release/Nodes Nodes Nodes-<version>-arm64-mac.zip.blockmap`

## Automated Verification
Run the packaged smoke:

```bash
npm run smoke:packaged:mac
```

This packages the app, launches the bundled `.app` with Selenium + `electron-chromedriver`, and verifies:
- bundle metadata and icon wiring
- preload bridge availability
- app home render
- app settings render with provider credentials before any project exists
- project creation
- canvas save/reload
- asset import and render
- queue screen render
- project settings render without provider credentials
- app settings render with provider credentials
- packaged SQLite and asset persistence

Run the full lifecycle helper:

```bash
npm run verify:mac-lifecycle
```

That prints the final artifact paths after the packaged smoke passes.

## Finder Walkthrough
1. Open `release/mac-arm64/Nodes Nodes Nodes.app` from Finder.
2. Confirm the app name reads `Nodes Nodes Nodes`.
3. Confirm the temporary pink square icon is used for the app.
4. Confirm app home lists any existing projects.
5. Create a project or open an existing packaged-app project.

## Provider Credentials
Open `App Settings` and use the `Provider Credentials` section.

Behavior:
- `Save to Keychain` writes the value into the macOS Keychain.
- `Clear Saved Key` removes only the Keychain value.
- if an environment value also exists, it becomes the fallback after the Keychain value is cleared.
- the renderer only sees credential status and source, never the raw key.

Credential precedence:
1. Keychain
2. Environment

## Running A Real Node
1. Open or create a project.
2. Add a runnable model node.
3. Add prompt or source inputs as required.
4. Trigger the run.
5. Confirm the Queue view shows the job moving through `queued` to `running` to a terminal state.
6. Confirm final outputs appear on canvas or in Assets.

## Data Locations
Packaged app runtime data lives under:
- `~/Library/Application Support/Nodes Node Nodes`

Key packaged-app paths:
- SQLite: `~/Library/Application Support/Nodes Node Nodes/node-interface-demo/app.sqlite`
- assets: `~/Library/Application Support/Nodes Node Nodes/node-interface-demo/assets/<projectId>/...`
- previews: `~/Library/Application Support/Nodes Node Nodes/node-interface-demo/previews/<jobId>/...`

Credentials are stored in the macOS Keychain under service:
- `com.rustymeadows.nodesnodenodes`

Accounts:
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `TOPAZ_API_KEY`

## Cleanup / Reset
To reset packaged-app local data:
1. Quit the app.
2. Remove `~/Library/Application Support/Nodes Node Nodes`.

To clear packaged-app credentials:
1. Open the app and clear them from App Settings, or
2. remove the matching Keychain entries for service `com.rustymeadows.nodesnodenodes`

## Source-Run vs Packaged App
- `npm run dev` launches the unpackaged source-run Electron app.
- Finder or `release/mac-arm64/Nodes Nodes Nodes.app` launches the packaged app.
- They are different processes and should be treated as different lifecycle stages during testing.
