# Prompt editing modal

This ExecPlan is maintained under the rules in `.agent/PLANS.md` and must be updated as progress occurs.

## Purpose / Big Picture

Nutrition coaches currently copy-paste long system prompts from the repository when experimenting with different GPT behaviors. The dashboard already imports two prompts (`MEAL_BREAKDOWN_PROMPT` and `PICTURE_GENERATION_PROMPT`) from `scripts/prompts.js`, but there is no in-app way to tweak the language without editing source files. This work introduces an accessible "Edit prompts" modal that surfaces those base instructions, explains how the app augments them with live data (e.g., meal titles, macro percentages), and lets coaches save local overrides that the dashboard will use immediately for meal grading and picture generation.

## Progress

- [x] (2025-02-14 00:00Z) Drafted ExecPlan documenting scope, architecture touch points, and validation strategy for the prompt editor modal.
- [x] (2025-02-14 00:46Z) Wired prompt registry/state helpers in `src/main.js`, including localStorage persistence, prompt metadata, and override restoration.
- [x] (2025-02-14 01:08Z) Built the prompt editor overlay with descriptive copy, textarea editors, focus management, and reset/save actions.
- [x] (2025-02-14 01:22Z) Routed `callMealBreakdown`/`buildPicturePrompt` through the editable prompts and refreshed wizard guidance text.
- [x] (2025-02-14 01:38Z) Added dedicated styles, dashboard header button, print-mode guard, and verified the bundle with `npm run build`.

## Surprises & Discoveries

- Observation: Initializing `promptEditorState` during `appState` construction caused a `ReferenceError` because the drafts helper relies on `appState.promptOverrides`.
  Evidence: Vite surfaced `ReferenceError: Cannot access 'appState' before initialization` until the code deferred `createInitialPromptEditorState()` until after `appState` existed (fixed by assigning the state immediately after instantiating the overlays).

## Decision Log

- Decision: Provide local-only overrides stored in `localStorage` keyed per prompt rather than rewriting `scripts/prompts.js` or introducing backend sync.
  Rationale: Keeps defaults reusable by the CLI script, avoids accidental repo diffs, and lets coaches experiment safely in their own browser session.
  Date/Author: 2025-02-14 / Codex

## Outcomes & Retrospective

- The dashboard now exposes an "Edit prompts" modal that summarizes how each prompt is used, lists the dynamic variables we append (titles, captions, macro percentages), and lets coaches edit, reset, and persist overrides per browser. Prompt metadata feeds a helper so `callMealBreakdown` and `buildPicturePrompt` both consume the live strings, while the uploader guidance points to the new control. Styling matches existing modals, the overlay hides in print mode, and `npm run build` succeeds. Future follow-up could expose CLI parity if shared storage is desired.

## Context and Orientation

All runtime UI/state management lives in `src/main.js`, including modal overlays (`createUploaderOverlay`, `createTileEditorOverlay`) and the GPT call paths (`callMealBreakdown`, `callPictureGeneration`). The base prompt strings are exported from `scripts/prompts.js` and imported into `src/main.js`; the `scripts/generate-dashboard.js` CLI also consumes them. Styles are centralized in `src/style.css`, so any new overlay classes should be defined there. There is currently no settings modal beyond the uploader, so we will introduce a new overlay node appended to `document.body`, following the patterns already in place for the uploader and tile editor.

## Plan of Work

1. **Introduce prompt registry + persistence**
   - In `src/main.js`, define a `PROMPT_KEYS` array with metadata (id, label, defaultValue from imports, descriptions of dynamic additions).
   - Extend `appState` with `promptOverrides`, `promptEditorState` (isOpen, drafts, status), and helper functions `getActivePrompt(id)` and `savePromptOverrides()`. Use `localStorage` (new key e.g., `emily-dashboard:prompts`) to load/save overrides on boot alongside the API key restore.
   - Update any existing helpers that rely on prompts (e.g., `buildPicturePrompt`) to call `getActivePrompt('pictureGeneration')` rather than the raw constants.

2. **Create modal overlay + renderer**
   - Add `createPromptEditorOverlay()` near other overlay creators; attach Escape/overlay click handlers similar to `createTileEditorOverlay`.
   - Implement `openPromptEditor`, `closePromptEditor`, and `renderPromptEditor` that build a dialog with:
     - Heading, short intro copy describing the prompts' role.
     - For each prompt: description of where it is used (system message vs. appended user instructions) and list dynamic variables (e.g., meal title, `Veg & Fruit %`). Below that, a textarea bound to `promptEditorState.drafts[id]`.
     - Footer buttons: Cancel (revert + close), Reset to defaults (clear overrides), and Save changes (persist overrides, update state, close).
   - Ensure focus management matches accessibility expectations (focus first textarea on open, return focus to opener on close if feasible).

3. **Hook modal into UI and behavior**
   - Add a header action button "Edit prompts" inside `renderDashboard` (non-print mode) that triggers `openPromptEditor`.
   - Update `renderUploaderInstructions` copy to mention the new modal and link text (plain text arrow) so users know where to adjust prompts.
   - Modify `callMealBreakdown` and `buildPicturePrompt` so they fetch prompts via the new helper; ensure `callPictureGeneration` displays updated prompt when logging/sending to API.
   - When saving overrides, re-render uploader/in-progress modals if open so descriptions reflect the new info.

4. **Styling and validation**
   - Add necessary CSS in `src/style.css` for `.prompt-editor-overlay`, `.prompt-editor`, fields, description blocks, etc., keeping visual style consistent with existing modals (rounded panel, drop shadow, etc.).
   - Run `npm run build` to confirm bundle integrity. Launch `npm run dev` locally (manual) to verify the modal opens, edits persist after reload, prompts are used for API payloads, and reset returns to defaults.

## Concrete Steps

1. From repo root run `npm install` if dependencies changed (not expected here).
2. Implement code edits per plan above.
3. Execute `npm run build` to ensure Vite compiles successfully.
4. Optionally run `npm run dev` for manual validation (document observations in Outcomes once complete).

## Validation and Acceptance

- Starting from a clean browser session, load the dashboard and click "Edit prompts".
- Expect a modal listing both prompts with descriptions of how they are applied and the dynamic tokens appended by the app.
- Edit text, click "Save changes", close the modal, and trigger a grading/picture generation flow; the outgoing API payloads must use the updated strings (can console.log or inspect network request payloads).
- Reload the page and confirm overrides persist (localStorage), and the modal displays the customized text.
- Use "Reset to defaults" to revert, confirming the default prompt text returns and persistence clears.

## Idempotence and Recovery

- Local overrides can be cleared safely; saving rewrites the localStorage value atomically.
- Modal open/close logic mirrors existing overlays; repeated toggles should not duplicate DOM nodes.
- If localStorage is unavailable, fall back to in-memory overrides without errors (log a warning similar to API key persistence).

## Artifacts and Notes

- Capture updated prompt copy or screenshots during validation once implemented.
- Document in `Outcomes & Retrospective` whether any additional prompts need exposing.

## Interfaces and Dependencies

- `src/main.js`: new prompt metadata, state, overlay functions, UI button, prompt retrieval helpers, adjustments to API call functions, integration with existing rendering flows.
- `src/style.css`: new styles for overlay/modal, textarea layout, description bullet list.
- No package.json changes expected unless additional utility is required (should avoid new deps).

