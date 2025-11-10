# Drag-and-drop grading for dashboard tiles

This ExecPlan is a living document maintained per `.agent/PLANS.md`. Any contributor can restart work from this file alone, so every section must stay current as implementation proceeds.

## Purpose / Big Picture

Parents and coaches currently need to open the data wizard, enter meals manually, and then run the generator before Emily's dashboard updates. This change lets someone drag any meal photo directly onto the visible image squares on the dashboard and also gives them a dedicated “Save API Key” experience so their OpenAI credential is stored once and reused everywhere. The user experience should be: run `npm run dev`, save the OpenAI key in the new card, drag a plate photo from the desktop onto a square, watch the square fill with that photo, and see the donut + allocation bars update once grading completes.

## Progress

- [x] (2025-11-10 20:30Z) Captured baseline behavior and drafted this ExecPlan with concrete acceptance criteria.
- [x] (2025-11-10 20:46Z) Wired dashboard tiles with drag/drop affordances, slot metadata, and per-tile upload state tracking.
- [x] (2025-11-10 20:46Z) Implemented the drop handler that converts files to base64, calls `callMealBreakdown`, updates the slot, and recomputes day summaries.
- [ ] (2025-11-10 20:46Z) Add UI polish (highlight, spinner/status messaging) plus README documentation, then run manual validation in `npm run dev` (done: styles & README; remaining: manual validation in a browser session).
- [x] (2025-11-10 20:54Z) Broke out the OpenAI API key into its own save/clear UX with local persistence so drops and the wizard reuse the stored value.

## Surprises & Discoveries

- Observation: OpenAI's Responses API rejects `input_image` objects that include an `image` field; it only accepts `image_url` (string) or `image_base64`.
  Evidence: Drag-and-drop grading surfaced “Unknown parameter: 'input[1].content[1].image'”; switching to `image_url` built from a data URL resolved the error for both the wizard (`scripts/generate-dashboard.js`) and in-app calls (`src/main.js`).
  Follow-up: The API expects `image_url` to be a string, not an object, so the handler now passes the data URL string directly.
- Observation: `text.format` now requires a `name` value when requesting JSON schemas through the Responses API.
  Evidence: Photo grading errored with “Missing required parameter: 'text.format.name'” until we populated `format.name` with the schema identifier in both code paths.
- Observation: `text.format` also expects a `schema` property that contains only the JSON Schema body, not the object with both `name` and `schema`.
  Evidence: After adding `format.name`, grading failed with “Missing required parameter: 'text.format.schema'” until we sent `schema: mealBreakdownSchema.schema` instead of the whole object.
- Observation: Responses API currently enforces `required` to list every `properties` entry; leaving `adjustmentTips` out caused “Invalid schema ... Missing 'adjustmentTips'.”
  Evidence: Drag-and-drop call failed on the pizza photo until the schema's `required` array included `adjustmentTips`, so optional fields now default to empty strings.
- Observation: The recommended approach is to set `response_format` at the top level; relying on `text.format` no longer yields `output_text`, so structured responses must be read from `output[].content[].json`.
  Evidence: The API replied “Meal breakdown returned empty output” because `output_text` was empty; switching to `response_format` and parsing `output_json` fixed the issue.

## Decision Log

- Decision: Reuse the in-browser `callMealBreakdown` helper instead of introducing a new backend, storing dropped images as inline `data:` URLs in `appState.dashboardData`.
  Rationale: Keeps all calls client-side like the existing data wizard and ensures download/export already works with inline assets.
  Date/Author: 2025-11-10 / Codex
- Decision: Persist the OpenAI API key via an explicit Save/Clear card that writes to `localStorage` and syncs `appState.formData.apiKey`.
  Rationale: Gives users a dedicated confirmation step, avoids accidental edits when tweaking other fields, and keeps drag-and-drop + the wizard in sync without retyping the key.
  Date/Author: 2025-11-10 / Codex

## Outcomes & Retrospective

- Pending. Summarize user-visible behavior and follow-ups once implementation & validation finish.

## Context and Orientation

The dashboard UI lives in `src/main.js` with pure DOM helpers. Meals render inside `createDayColumn` ➜ `createMealCard`, while empty slots use `createPlaceholderCard`. Dashboard state sits in `appState.dashboardData`. The wizard already calls OpenAI via `callMealBreakdown` and `callPictureGeneration`, but the visible tiles have no interactions today. CSS in `src/style.css` defines `.meal-card` styling. Users launch the app with `npm run dev` (Vite) and interact through the browser; no tests currently exist.

## Plan of Work

1. **State & helpers** (`src/main.js`): extend `appState` with `tileUploads` metadata plus utility functions to compute per-day summaries (skipping pending tiles), to fetch a slot's key (`dayIndex:slotIndex`), and to upsert/remove meals at specific slots without breaking existing arrays.
2. **Rendering hooks** (`src/main.js`): update `createDayColumn`, `createMealCard`, and `createPlaceholderCard` to accept both the zero-based `dayIndex` and `slotIndex`. Each tile should:
    - Add a `meal-card--droppable` class.
    - Include a `div.meal-card__drop-overlay` that shows “Drop image to grade” when idle and status text when processing.
    - Register `dragenter`, `dragover`, `dragleave`, and `drop` listeners that delegate to shared handlers.
3. **Drop workflow** (`src/main.js`):
    - Implement `handleTileDrop(dayIndex, slotIndex, fileList)` that validates image files, ensures an OpenAI API key exists (`appState.formData.apiKey`), converts the first file via `fileToBase64`, writes a temporary `pending` meal into `appState.dashboardData.days[dayIndex].meals[slotIndex]`, and updates `appState.tileUploads`.
    - Call `callMealBreakdown` with the base64 payload; on success, store the normalized breakdown plus summary, flip `pending` off, and recompute `day.summary` using the new helper. On failure, remove the pending meal and surface an alert.
    - Always rerender the dashboard so allocation bars/donuts stay in sync.
4. **Styles** (`src/style.css`): add classes for `.meal-card--droppable`, `.meal-card--dragover`, `.meal-card--processing`, `.meal-card__drop-overlay`, and `.meal-card__spinner` (a simple CSS animation or pulse) so drag targets are obvious and in-flight work is visible.
5. **README** (`README.md`): document the new drag-and-drop flow, including the requirement to set an API key via the Data Wizard so grading can use the Responses API.
6. **API key save experience** (`src/main.js`, `src/style.css`, `README.md`): introduce a standalone API key manager with password field, Save/Clear buttons, and local persistence (e.g., `localStorage`) so the key survives page reloads and clearly communicates when it is stored. Update docs to mention the new workflow.

## Concrete Steps

All commands run from the repo root.

1. `npm install` (only if dependencies are missing).
2. `npm run dev` to launch Vite and manually test drag/drop in the browser.

Document any additional scripts (e.g., lint) if we introduce them.

## Validation and Acceptance

- Launch `npm run dev`, open the app, drop two different meal photos onto different day squares.
- Expect each square to show a spinner, then the dropped photo.
- After grading completes, hover the card to see the breakdown tooltip and confirm the corresponding day's donut + allocation bars update to match the returned percentages.
- Use **Download JSON** to ensure the new meals (with inline images + breakdown values) appear in the exported file.

## Idempotence and Recovery

- Dragging a new image onto the same slot should overwrite the existing meal after a successful re-grade.
- If grading fails, the UI should revert the slot to an empty placeholder and clear the spinner. The user can retry immediately.
- Because we only mutate in-browser state, refreshing the page reloads the last saved dataset from `/data/dashboard-data.json`; document that users must download/export if they want to persist new drops.

## Artifacts and Notes

- Capture screenshots or console snippets once the feature works (e.g., sample breakdown JSON and a short note confirming donut changes). Update here when available.

## Interfaces and Dependencies

- `src/main.js`
    - Extend `appState` with `tileUploads`.
    - Add helpers `getTileKey(dayIndex, slotIndex)`, `setTileUploadState(key, data)`, `upsertDashboardMeal(dayIndex, slotIndex, meal)`, and `recomputeDaySummary(dayIndex)`.
    - Modify `createDayColumn`, `createMealCard`, `createPlaceholderCard`, and new handler functions `attachTileDropTarget(element, { dayIndex, slotIndex })`, `handleTileDropEvent(event)` that route into `processDroppedFile`.
    - Implement `processDroppedFile(dayIndex, slotIndex, file)` which uses the existing `fileToBase64`, `callMealBreakdown`, and `normalizeBreakdown`.
- `src/style.css`
    - Define new classes for drag-hover state, overlay messaging, and spinner animation.
- `README.md`
    - Add a “Drag-and-drop grading” subsection under “Populate data” or “Preview the dashboard” describing the workflow.
- API key manager:
    - `src/main.js`: add `API_KEY_STORAGE_KEY`, `appState.apiKeyDraft`, `appState.apiKeyStatus`, helpers `restoreSavedApiKey()`, `persistApiKey(value)`, `clearSavedApiKey()`, and a `renderApiKeyManager()` section with Save/Clear buttons that updates `localStorage` and `appState.formData.apiKey`.
    - `src/style.css`: style the new API key card, button row, and status text.
    - `README.md`: describe that the dashboard now has an “OpenAI API Key” save card and that the stored key powers drag-and-drop grading plus the wizard.

Document any additional modules we touch as work progresses.

Note (2025-11-10 20:46Z): Updated progress after implementing drag/drop plumbing and grading logic; UI polishing and validation remain.
Note (2025-11-10 20:46Z #2): Clarified that manual validation still needs to happen in a browser session; build validation succeeded via `npm run build`.
Note (2025-11-10 20:55Z): Added a new milestone for the dedicated API key save UX per the latest requirements.
Note (2025-11-10 20:56Z #3): Marked the API key save UX as implemented and recorded the persistence decision.
