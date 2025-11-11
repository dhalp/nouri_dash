# Interactive prompt editor modal

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Users currently rely on hard-coded prompt strings defined in `scripts/prompts.js`. Editing them requires modifying source files, and there is no in-app visibility into how each prompt powers the OpenAI workflow. By adding an interactive modal, a coach can inspect and customize the Meal Breakdown and Picture Generation prompts directly from the dashboard before running meal analysis. The modal will explain where each prompt is applied and list any runtime variables appended to it, helping users adjust wording safely while understanding downstream effects.

## Progress

- [x] (2025-11-11 01:48Z) Drafted initial ExecPlan outlining prompt editor goals and approach.
- [x] (2025-11-11 02:05Z) Implemented prompt editor modal, state management, and persistence.
- [x] (2025-11-11 02:09Z) Verified prompt overrides power both OpenAI flows and completed `npm run build`.
- [x] (2025-11-11 02:12Z) Updated plan with outcomes and retrospective notes.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Persist prompt overrides in `localStorage` and fall back to defaults when the saved value is blank.
  Rationale: Keeps user customizations browser-specific without risking empty prompts in API calls.
  Date/Author: 2025-11-11 02:05Z / Assistant

## Outcomes & Retrospective

- Delivered a reusable prompt editor modal with descriptions and variable notes, wired to the wizard via a new “Edit prompts” action. Prompts now persist per-browser and feed both the meal breakdown system message and picture generation prefix. `npm run build` passes, and the UI mirrors existing modal styling for consistency.

## Context and Orientation

The web dashboard UI lives in `src/main.js` with supporting styles in `src/style.css`. Prompt templates are exported from `scripts/prompts.js` and imported at the top of `src/main.js`. Meal analysis is triggered through `runGeneration()` in `src/main.js`, which calls `callMealBreakdown()` and `callPictureGeneration()`. `callMealBreakdown()` currently embeds `MEAL_BREAKDOWN_PROMPT` directly in the OpenAI API payload. `buildPicturePrompt()` prepends `PICTURE_GENERATION_PROMPT` to dynamically generated lines before `callPictureGeneration()` sends it to OpenAI.

Existing overlays (meal uploader, tile editor) demonstrate patterns for modal overlays: `createTileEditorOverlay()` returns a hidden overlay appended to `document.body` and toggled via an `is-open` class. Styles for overlays and modals live around line 500 in `src/style.css`.

We will introduce prompt editing state into `appState` (defined near the top of `src/main.js`), alongside helper functions that read/write prompt overrides from `localStorage` (similar to API key persistence at lines 600–660 of `src/main.js`). The modal should mirror the tile editor’s structure while listing each prompt, usage notes, and runtime variables appended later in code.

## Plan of Work

Describe the intended steps:

1. Extend application state in `src/main.js` with default prompt values and editor modal state. Implement helper functions `createInitialPromptState()` and `createInitialPromptEditorState()`. Load persisted prompt overrides from `localStorage` during initialization and persist updates when the user saves changes.
2. Create DOM helpers in `src/main.js` to open/close the prompt editor overlay. Follow the existing modal patterns (`createTileEditorOverlay`, `renderTileEditor`). Build `renderPromptEditor()` to populate the modal with two sections (Meal Breakdown, Picture Generation), each containing:
   - Description of how the prompt is used (e.g., system prompt for analysis, base text for picture generation) and runtime variable summary (e.g., for pictures: meal title, background guidance, percentage summary, core notes). 
   - A textarea bound to editable prompt text, with buttons to reset to defaults and save/apply changes.
3. Add a trigger button within `renderUploaderInstructions()` (Prompt Workflow section) so users can launch the modal. Ensure button labels and aria attributes match existing style conventions.
4. Update OpenAI request builders in `src/main.js` so they use the editable prompt values from state instead of the imported constants. `callMealBreakdown()` should inject `appState.prompts.mealBreakdown`. `buildPicturePrompt()` should use `appState.prompts.pictureGeneration` as its base string. Maintain the dynamic lines appended after the base prompt.
5. Style the new modal in `src/style.css`, creating classes such as `.prompt-editor-overlay`, `.prompt-editor`, `.prompt-editor__section`, `.prompt-editor__description`, `.prompt-editor__variables`. Reuse typography and spacing tokens where possible for consistency. Include responsive behavior similar to existing modals.
6. Ensure initialization populates prompt drafts when opening the modal and saving updates re-renders dependent UI (e.g., note in instructions). Provide user feedback inside the modal upon save (e.g., inline status text or subtle confirmation) per existing UI patterns.
7. Update documentation in the modal only (no repo docs) to describe prompt usage; ensure no other files require textual updates.

## Concrete Steps

1. In `src/main.js`, define prompt state helpers and integrate persistence (read from storage after API key restore, write on save). Add overlay creation logic and modal rendering functions.
2. Modify `renderUploaderInstructions()` to include an “Edit prompts” button that calls the prompt editor open handler.
3. Update `callMealBreakdown()` and `buildPicturePrompt()` to reference state-driven prompt values.
4. Create modal event handlers (`handlePromptEditorSave`, `handlePromptEditorReset`, etc.) ensuring they mutate state and persist to storage.
5. Add corresponding styles to `src/style.css` for the overlay and modal layout.
6. Manually test in dev server if possible; otherwise validate via `npm run build`.

## Validation and Acceptance

- Start the dev server (`npm run dev`) or rely on static review to ensure UI renders without runtime errors. If dev server use is impractical, smoke test via `npm run build` to catch syntax issues.
- Acceptance: Opening the uploader overlay should show an “Edit prompts” control. Clicking it opens a modal listing both prompts with descriptions and variable notes. Editing text, saving, and closing should persist changes (verified by reopening modal and by generating meals to ensure new prompt values appear in network payload—spot-check via console logging or instrumentation). Resetting should restore defaults. Running `npm run build` should succeed.

## Idempotence and Recovery

- Saving prompt changes should overwrite prior overrides; resetting should clear stored overrides and restore defaults. Operations should handle missing `localStorage` gracefully (log warnings, no crashes).
- Modal open/close should be safe to call multiple times; unsaved changes remain in draft until saved or reset.

## Artifacts and Notes

- None yet.

## Interfaces and Dependencies

- `appState.prompts.mealBreakdown` and `appState.prompts.pictureGeneration`: strings used by `callMealBreakdown()` and `buildPicturePrompt()`.
- LocalStorage key (e.g., `emily-dashboard:prompts`) storing JSON `{ mealBreakdown: string, pictureGeneration: string }`.
- Modal DOM structure using classes `.prompt-editor-overlay`, `.prompt-editor`, `.prompt-editor__section`, `.prompt-editor__actions`, `.prompt-editor__status` for styling hooks.
