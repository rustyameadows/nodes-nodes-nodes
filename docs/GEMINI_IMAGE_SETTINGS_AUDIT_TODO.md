# Gemini Image Settings Audit TODO

Last updated: 2026-03-10

## Current State
- Local implementation now includes:
  - shared Gemini image controls: `temperature`, `aspectRatio`, `maxOutputTokens`, `topP`, `stopSequences`
  - `imageSize` on `gemini-3-pro-image-preview`
  - `imageSize` on `gemini-3.1-flash-image-preview`
  - `thinkingLevel` on `gemini-3.1-flash-image-preview`
  - `outputMode` on `gemini-3.1-flash-image-preview`
- Gemini image requests already use `ai.models.generateContent`.
- The new local `resolveGeminiImageSettings(...)` implementation now strips the generic OpenAI-era Gemini image leftovers from effective settings:
  - `outputFormat`
  - `quality`
  - `size`
  - `background`
  - `moderation`
  - `inputFidelity`
  - `n`
- The runtime provider request path has also been switched to use the shared Gemini image config builder, so debug request shape and live request shape now match locally.

## Local Progress Snapshot
- `src/lib/gemini-image-settings.ts`
  - replaced the tiny image-config-only profile layer with model-aware Gemini image profiles
  - added shared Gemini image controls
  - added `imageSize` for `gemini-3.1-flash-image-preview`
  - added `thinkingLevel` for `gemini-3.1-flash-image-preview`
  - added `outputMode` for `gemini-3.1-flash-image-preview`
  - aligned default visible values with the AI Studio screenshots:
    - `Temperature: 1`
    - `Top P: 0.95`
    - `Output Length: 32768` on `gemini-2.5-flash-image` and `gemini-3-pro-image-preview`
    - `Output Length: 65536` on `gemini-3.1-flash-image-preview`
  - added shared request-config builder for Gemini image jobs
- `src/lib/providers/registry.ts`
  - Gemini image runtime now uses the shared Gemini image request-config builder
- `src/lib/gemini-image-settings.test.ts`
  - updated to cover the expanded Gemini image setting surface
- `src/lib/google-gemini-provider.test.ts`
  - updated to assert the expanded model-aware Gemini image parameter lists
- Local verification completed:
  - `npm run test:unit` passed after the Gemini image settings changes
  - browser verification on `/nodes/model` confirmed:
    - `gemini-2.5-flash-image` shows `Temperature`, `Aspect Ratio`, `Output Length`, `Top P`, `Stop Sequences`
    - `gemini-3-pro-image-preview` additionally shows `Resolution`
    - `gemini-3.1-flash-image-preview` additionally shows `Output Format`, `Resolution`, `Thinking Level`

## Confirmed Support Matrix
### `gemini-2.5-flash-image`
- Confirmed from official docs:
  - input: images + text
  - output: images + text
  - output token limit: `32768`
  - `thinking`: not supported
  - `imageConfig.aspectRatio`: supported
  - `imageConfig.imageSize`: not documented for this model
- Product implication:
  - expose `aspectRatio`
  - do not expose `imageSize`
  - do not expose `thinkingLevel`

### `gemini-3-pro-image-preview`
- Confirmed from official docs:
  - input: image + text
  - output: image + text
  - output token limit: `32768`
  - `thinking`: supported
  - `imageConfig.aspectRatio`: supported
  - `imageConfig.imageSize`: supported (`1K`, `2K`, `4K`)
- Product implication:
  - expose `aspectRatio`
  - expose `imageSize`
  - thinking support exists at the model level, but we still need an official request-shape confirmation before exposing a `thinkingLevel` UI control

### `gemini-3.1-flash-image-preview`
- Confirmed from official docs:
  - input: text and image / PDF
  - output: image and text
  - output token limit: `32768`
  - `thinking`: supported
  - `search grounding`: supported
  - `imageConfig.aspectRatio`: supported
  - `imageConfig.imageSize`: supported (`512`, `1K`, `2K`, `4K`)
  - `responseModalities: ["TEXT", "IMAGE"]`: documented
  - `responseModalities: ["IMAGE"]`: documented
- Product implication:
  - expose `aspectRatio`
  - expose `imageSize`
  - expose an output mode control if we want the `Images & text` vs `Images only` behavior
  - expose `thinkingLevel` only after confirming the exact request mapping we want in our app

## Evidence Collected
### Local SDK types (`@google/genai`)
- `GenerateContentConfig` supports:
  - `systemInstruction`
  - `temperature`
  - `topP`
  - `topK`
  - `maxOutputTokens`
  - `stopSequences`
  - `responseModalities`
  - `thinkingConfig`
  - `imageConfig`
- `ImageConfig` supports:
  - `aspectRatio`
  - `imageSize`
  - `personGeneration`
  - `prominentPeople`
- `ImageConfig.outputMimeType` is explicitly marked unsupported in the Gemini API typings.

### Official docs verified so far
- Google model overview confirms all 3 launch models are exposed through the Gemini API:
  - `gemini-2.5-flash-image`
  - `gemini-3-pro-image-preview`
  - `gemini-3.1-flash-image-preview`
- The model overview also confirms:
  - `gemini-2.5-flash-image` is the state-of-the-art image generation and editing model
  - `gemini-3-pro-image-preview` supports image generation, image editing, and structured outputs
  - `gemini-3.1-flash-image-preview` supports image generation, image editing, and thinking
- The official Gemini image-generation docs and SDK types align on `imageConfig.aspectRatio` and `imageConfig.imageSize` as the explicit Gemini image-config knobs.
- The SDK explicitly marks `ImageConfig.outputMimeType` as unsupported in Gemini API, so we should not expose format switching as a Gemini image control in the current app.
- The image-generation guide explicitly documents:
  - `gemini-2.5-flash-image` with `aspectRatio` only
  - `gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview` with `aspectRatio` plus `imageSize`
  - `gemini-3.1-flash-image-preview` with both `responseModalities: ["TEXT", "IMAGE"]` and `responseModalities: ["IMAGE"]`

### Google AI Studio screenshots from user
- `gemini-2.5-flash-image` (`Nano Banana`) shows:
  - `Temperature`
  - `Aspect ratio`
  - advanced `Add stop sequence`
  - advanced `Output length`
  - advanced `Top P`
- `gemini-3-pro-image-preview` (`Nano Banana Pro`) shows:
  - `Temperature`
  - `Aspect ratio`
  - `Resolution`
  - tools section
  - advanced `Add stop sequence`
  - advanced `Output length`
  - advanced `Top P`
- `gemini-3.1-flash-image-preview` (`Nano Banana 2`) shows:
  - `Output format` (`Images & text` vs `Images only`)
  - `Temperature`
  - `Aspect ratio`
  - `Resolution`
  - `Thinking level`
  - tools section
  - advanced `Add stop sequence`
  - advanced `Output length`
  - advanced `Top P`

## Likely Product Direction
The Gemini image node should stop pretending it is an OpenAI image node with a different provider ID. We should switch it to a Gemini-specific curated surface that reflects the `generateContent` API and is model-aware.

## Proposed Curated Gemini Image Surface
### Shared Gemini image controls
- `aspectRatio`
- `temperature`
- `topP`
- `maxOutputTokens`
- `stopSequences`

### Model-specific Gemini image controls
- `gemini-2.5-flash-image`
  - shared controls
  - no `imageSize`
- `gemini-3-pro-image-preview`
  - shared controls
  - `imageSize`
- `gemini-3.1-flash-image-preview`
  - shared controls
  - `imageSize`
  - `thinkingLevel` if the request mapping is confirmed
  - `responseModalities` / output mode

## Explicitly Out Of Scope Unless Official Docs Confirm
- `personGeneration`
- `prominentPeople`
- tool toggles (`Google Search`, `Image search`)
- `topK`
- safety/person-generation toggles

Reason:
- these are either not part of the current canvas UX,
- not clearly documented yet for our supported Gemini image models,
- or would pull the node into a broader Gemini feature surface than we want right now.

## Code Areas To Change
- `src/lib/gemini-image-settings.ts`
  - move from tiny image-config-only model profiles to fuller Gemini image model profiles
- `src/lib/provider-model-helpers.ts`
  - ensure Gemini image defaults and parameter definitions stay model-aware
- `src/lib/providers/registry.ts`
  - send the expanded Gemini image config in requests
- `src/renderer/browser-node-interface.ts`
  - keep browser-preview Gemini settings in sync with the real provider catalog
- docs:
  - `docs/PROVIDER_INTEGRATIONS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/DATA_MODEL.md`
  - `docs/UX_CANVAS_AND_ASSETS.md`
  - `docs/DECISIONS.md`

## Immediate TODO
- [x] Confirm model-specific `imageSize` support from official docs
- [x] Confirm `responseModalities` support for `gemini-3.1-flash-image-preview`
- [x] Decide and implement the expanded Gemini image UI surface locally:
  - shared: `temperature`, `topP`, `maxOutputTokens`, `stopSequences`, `aspectRatio`
  - `gemini-3-pro-image-preview`: `imageSize`
  - `gemini-3.1-flash-image-preview`: `imageSize`
  - `gemini-3.1-flash-image-preview`: `thinkingLevel`
- [x] Implement `outputMode` for `gemini-3.1-flash-image-preview`
- [x] Remove OpenAI-style image defaults from Gemini image effective settings
- [x] Update `src/lib/gemini-image-settings.ts` to use the confirmed model matrix
- [x] Update Gemini image request building so:
  - shared generation controls map to top-level `GenerateContentConfig`
  - `aspectRatio` / `imageSize` map to `imageConfig`
- [x] Expose a user-facing output mode for `gemini-3.1-flash-image-preview`
- [ ] Update browser-preview Gemini metadata so the Node Library playground matches the real provider exactly
- [ ] Update provider/docs after the final Gemini image surface is chosen:
  - `docs/PROVIDER_INTEGRATIONS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/DATA_MODEL.md`
  - `docs/UX_CANVAS_AND_ASSETS.md`
  - `docs/DECISIONS.md`
- [ ] Verify in:
  - canvas model node
  - Node Library model playground
- [ ] Run `npm run lint` again after the latest note/docs/code updates
- [ ] Run `npm run build`
- [ ] Package a new mac build after the Gemini image surface is corrected

## Official Sources
- Model overview:
  - `gemini-2.5-flash-image`: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
  - `gemini-3-pro-image-preview`: https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview
  - `gemini-3.1-flash-image-preview`: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image-preview
- Image generation guide:
  - https://ai.google.dev/gemini-api/docs/image-generation
