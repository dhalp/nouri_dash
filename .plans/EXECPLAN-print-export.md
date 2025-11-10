# Print-ready landscape PDF export

## Purpose / Big Picture

Families want to hand a clean, landscape dashboard to teachers, dietitians, and printers without futzing with screenshots. The current "Export PDF" control actually creates a PNG snapshot of the existing DOM, so sizing depends on the user's browser zoom, legend placement drifts, and printing forces one-off tweaks each time. This initiative replaces the screenshot-based pipeline with a purpose-built PDF composer that always produces an 11" × 8.5" landscape page where the upper-left corner reads `Name's tracked meals`, the legend (including the "n" brand circle and donut) hugs the upper-right margin, and seven evenly spaced day columns populate the body even if the underlying dataset has fewer days. When the work is done, tapping Export generates a vector PDF that already honors print margins, embeds the inline meal imagery, and can head straight to a printer or be emailed as-is.

## Progress

- [x] (2025-11-10 22:31Z) Captured the current PNG export behavior, gathered layout constraints, and drafted this PDF-first ExecPlan.
- [x] (2025-11-10 22:40Z) Added `pdf-lib`, introduced `src/export/pdf-constants.js` + `src/export/pdf-utils.js`, and implemented normalization helpers plus data URL decoding.
- [x] (2025-11-10 22:41Z) Built `src/export/pdf-composer.js` to draw the header, legend (with donut + brand circle), seven columns, meal cards, and macro bars directly onto the PDF canvas.
- [x] (2025-11-10 22:42Z) Replaced the PNG snapshot flow in `src/main.js` with the new composer, refreshed the preview modal + saving logic, removed `html-to-image`, updated styles/docs, and verified with `npm run build`.
- [x] (2025-11-10 22:55Z) Rebalanced the PDF layout (dynamic column math, slimmer header/legend, softer image placeholders, text wrapping) so all seven day columns fit the printable area without scaling hacks.
- [x] (2025-11-10 22:56Z) Added `data/dashboard-sample.json` plus `npm run test:export`, which renders a sample PDF into `dist/sample-dashboard.pdf` and asserts the stacked layout stays within the letter landscape bounds.
- [ ] (2025-11-10 22:56Z) Manual validation in `npm run dev` to inspect the PDF in-browser and confirm printing behaves as expected (sample PDF now generated automatically for easy spot checks).

## Surprises & Discoveries

- Observation: `createExportButton` in `src/main.js` uses `html-to-image` to clone `.dashboard-canvas`, scales it to 11" × 8.5" worth of pixels, and only then wraps the PNG in the preview modal. That keeps styling consistent with the on-screen DOM but yields raster output and inherits every stray flexbox quirk present in the live layout.
  Evidence: `createExportSnapshot`, `buildExportRenderConfig`, and `appendExportMargins` (roughly lines 420–610) hard-code the PNG workflow and never touch a PDF library.
  Follow-up: We need a renderer that speaks PDF primitives directly so typography, donuts, and grid spacing are deterministic and independent of the browser's rendering engine.
- Observation: The seven-column layout only snaps into an even grid because `.dashboard-canvas--export` forces `grid-template-columns: repeat(7, 1fr)` inside `src/style.css`, but the underlying data (`appState.dashboardData.days`) may have fewer or differently named days.
  Evidence: `renderDashboard` computes `dayCount = Math.max(data.days?.length ?? 0, 7);`, rendering placeholder sections when data is sparse, while the export snapshot merely clones whatever DOM is visible at that moment.
  Follow-up: The PDF composer must explicitly normalize to seven columns (padding with empty day shells) rather than hoping the live DOM already did so.
- Observation: Every meal already holds inline imagery via `meal.generatedImageDataUrl` or `meal.source.dataUrl`, so we can embed the exact pixels into the PDF without reaching back to the server.
  Evidence: Drag-and-drop fills `meal.source` with `{ type: 'inline-image', dataUrl }`, and the download/export JSON flow relies on those data URLs.
  Follow-up: We should add a helper that converts a `data:image/png;base64,...` string into raw bytes so `pdf-lib` can embed the bitmap directly.
- Observation: Hard-coded 2.05" meal cards plus a tall header exceeded the 8.5" landscape height, so exports clipped unless the printer scaled the output down.
  Evidence: Printing the first pass required 77% browser scaling and still showed extra white margins; the layout math never referenced the available body height.
  Follow-up: Compute card heights from the remaining body height, cap donut radius, and wrap text so we always fill (but never exceed) the printable canvas.
- Observation: Placeholder rectangles rendered as stark black boxes whenever a meal lacked imagery, which looked worse on paper than the in-app outlines.
  Evidence: The PDF fallback simply drew a solid rectangle using the neutral color; when multiple slots lacked photos the grid looked unfinished.
  Follow-up: Introduce a light frosted placeholder with diagonal strokes and helper text so empty slots still feel intentional in printouts.

## Decision Log

- Decision: Adopt `pdf-lib` for PDF creation, composing every element (text, donut wedges, rectangles, and embedded bitmaps) explicitly instead of rasterizing the DOM.
  Rationale: `pdf-lib` ships as an ESM package, works in browsers without native binaries, exposes measurement control in points, and keeps the final asset vector-friendly so text stays crisp when printing.
  Date/Author: 2025-11-10 / Codex
- Decision: Build a dedicated export composer module (e.g., `src/export/pdf-composer.js`) that ingests normalized dashboard data and returns `{ blob, meta }`, keeping UI code (`src/main.js`) focused on wiring buttons and preview state.
  Rationale: Separating composition from UI makes it easier to test layout math in isolation, reuse the composer later (e.g., automated emailing), and prevents the DOM from being a hidden dependency of the PDF output.
  Date/Author: 2025-11-10 / Codex
- Decision: Remove `html-to-image` and the DOM-clone export snapshot entirely so the bundle only ships the PDF composer path.
  Rationale: Eliminates unused bytes, avoids confusing CSS tied to the old snapshot mode, and ensures every export path stays in sync with the vector layout.
  Date/Author: 2025-11-10 / Codex
- Decision: Drive all PDF layout measurements from the printable body height (dynamic card heights, capped donut radius, responsive gutters) instead of fixed inches.
  Rationale: Guarantees the exported sheet fits a letter landscape page without manual scaling and keeps spacing consistent regardless of content length.
  Date/Author: 2025-11-10 / Codex
- Decision: Check in `data/dashboard-sample.json` plus `scripts/validate-export-layout.js` and wire it to `npm run test:export`.
  Rationale: Provides a deterministic way to exercise the composer, produces a reference PDF for designers, and prevents regressions where a future change accidentally reintroduces clipping.
  Date/Author: 2025-11-10 / Codex

## Outcomes & Retrospective

- The export button now generates a deterministic, vector PDF with the prescribed header/legend placement and seven evenly spaced columns. `npm run test:export` writes `dist/sample-dashboard.pdf` and confirms the stacked layout fits within the printable bounds, and `npm run build` succeeds. Manual browser validation + real printer checks remain outstanding.

Note (2025-11-10 22:56Z): Reflowed the PDF layout (dynamic heights, softer placeholders), added the sample dataset + validation script, and documented how to run `npm run test:export` so future contributors can verify exports without manual tweaking.

## Context and Orientation

The repo is a Vite-powered static site (`npm run dev` launches the dashboard). All runtime UI logic lives in `src/main.js`, including state (`appState`), the drag-and-drop grading workflow, and the refreshed export overlay that now expects PDF blobs. Styles reside in `src/style.css`, with `.export-preview` showing either the embedded PDF or a placeholder. Meal data is loaded at start via `loadDashboardData` and stored as inline JSON with base64 images, so no backend is involved. The print pipeline now flows through `src/export/pdf-constants.js` (units, palette defaults), `src/export/pdf-utils.js` (normalization + data URL decoding), and `src/export/pdf-composer.js` (draws the header, legend, seven columns, donuts, and meal cards via `pdf-lib`). The execution environment is browser-only, so dependencies must work in ESM without Node shims.

## Plan of Work

1. **Define layout spec + invariants**: Document constants in a new module (e.g., `src/export/pdf-constants.js`) for `LETTER_WIDTH_IN = 11`, `LETTER_HEIGHT_IN = 8.5`, base DPI (72 points per inch inside PDFs), and margins (e.g., 0.35"). Specify column count (7), gutter spacing, header height, and the relative space allocated to the legend block versus the day grid. Capture how donuts, legend swatches, and the "n" circle should be drawn (stroke widths, typography sizes) so every future contributor knows the exact geometry.
2. **Create PDF utilities and normalization helpers**:
    - Add `pdf-lib` to `package.json` and wire it through Vite.
    - Under `src/export/`, add helpers for `inchesToPoints`, `pointsToInches`, and `dataUrlToUint8Array`.
    - Write a `normalizeDashboardForExport(data)` function that clones `appState.dashboardData`, enforces seven days (padding with placeholders like `{ label: "Day N", meals: [] }`), ensures each day has up to three meals (adding `null` placeholders as needed), and resolves palette + legend colors.
    - Add a `deriveMealImage(meal)` helper that picks `meal.generatedImageDataUrl || meal.source?.dataUrl || ''` and flags when no image exists so the card can fall back to a neutral block.
3. **Implement header + legend composer**:
    - Create `composeHeader(page, doc, context)` that writes the left-aligned `Name's tracked meals` string using a bold face (embed Helvetica Bold or a downloaded Nunito subset) and renders the optional week label underneath if product design wants two lines.
    - Build `composeLegend(page, doc, palette, position)` to draw the donut (two concentric circles, then `pdf-lib` path arcs for each category proportion) and the category list, right-aligned with labels and color bullets; end with the circular "n" mark (white letter, colored fill) touching the right margin.
    - Ensure the header block reports its consumed height so the day grid can start directly beneath it without overlap.
4. **Compose the seven-column grid**:
    - Calculate each column's width as `(pageWidth - 2 * margin - 6 * gutter) / 7`, with a fixed column gutter (e.g., 8–10 points).
    - For each normalized day, draw: (a) the day label (uppercase) near the top of the column, (b) a small donut or stacked bar summarizing macros via `aggregateDay`, and (c) up to three meal cards. Meal cards should show the photo (embed JPEG/PNG scaled to a square), the meal title, and a horizontal allocation bar for the four categories.
    - Use shared drawing helpers for rounded rectangles, background shades, and text so adjusting typography later stays centralized.
    - When a meal slot is empty, fill the rectangle with a muted "Ready for meal photo" placeholder so the printed sheet still conveys the expectation.
5. **Integrate with the UI and preview UX**:
    - Update `createExportButton` to call a new async `renderDashboardPdf(appState.dashboardData)` instead of `toPng`. The composer should return both the PDF blob and metadata (page size, column widths).
    - Revise `exportPreviewState` so it stores a `pdfBlobUrl` in addition to filename/meta; reuse the overlay but swap the `<img>` preview for either an `<iframe>`/`<object>` (Chromium) or a simple "PDF ready" illustration when embedding is unsupported.
    - Update `handleExportSave` to stream the PDF blob (not a data URL) through the File System Access API or fallback anchor download. Keep filename sanitization + `.pdf` extension enforcement.
    - Remove unused PNG-specific helpers (snapshot clone, html-to-image dependency) once the PDF path fully replaces them.
6. **Polish styles and docs**:
    - Refresh `.export-preview` styles to account for the embedded PDF viewer (set fixed height, fallback message, spinner while blob loads).
    - Update README's export section to describe the new PDF behavior, the guaranteed layout (title left, legend right, seven columns), and printing tips.
7. **Validation + guardrails**:
    - Manually exercise exports with (a) the default sample data, (b) a sparse dataset (only three days), and (c) a full week with drag-and-drop photos to ensure embedded images appear.
    - Verify the resulting file opens in Preview/Adobe Reader, prints without clipping, and that selecting text shows real glyphs (proving it is vector).
    - If time permits, add a lightweight snapshot test (e.g., comparing the JSON layout model prior to drawing) to guard against accidental column-count regressions.

## Concrete Steps

All commands run from the repo root:

1. `npm install` (pulls in `pdf-lib` once added to `package.json`).
2. `npm run dev` to iterate in a browser; use the export button repeatedly while tuning layout.
3. `npm run build` to confirm Vite bundles the new PDF modules without Node polyfills.

## Validation and Acceptance

- Launch `npm run dev`, load the dashboard in a Chromium browser, and click **Export PDF**.
- Expect a modal that now references a PDF (embedded preview or download prompt) whose metadata matches "Tracked meals — landscape letter".
- Open the downloaded PDF and verify:
  - The first line reads `<Client name>'s tracked meals` at the upper-left margin.
  - The legend list, donut, and the circular "n" glyph sit against the right margin, maintaining their order even when the client name is long.
  - Exactly seven day columns span the page with equal widths and gutters, regardless of how many days were present in the dataset.
  - Meal cards show their photos (or placeholders) and macro bars without clipping, and text remains selectable.
- Print to paper or system print preview to confirm nothing falls outside the safe area and margins remain consistent.

## Idempotence and Recovery

- Exporting is pure: it never mutates `appState.dashboardData`, so repeated exports are safe.
- If PDF generation throws (e.g., invalid image data), catch the error, surface a toast/modal message, and leave the previous preview untouched so the user can retry immediately.
- Because the composer runs entirely in-browser, reloading the page resets the UI; no server state needs cleanup.

## Artifacts and Notes

- Once the PDF composer exists, capture at least one exported file (or screenshot of the PDF) to confirm column and header placement, then reference it here for posterity.
- Record any color-calibration notes (e.g., printers muting Pause Food red) if testing reveals adjustments are necessary.

## Interfaces and Dependencies

- `package.json`: add `"pdf-lib": "^x.y.z"` (choose the latest stable release) and ensure `node_modules` are committed via lockfile updates.
- `src/export/pdf-constants.js`: define numeric constants (page sizes, margins, gutters, typography scales, category palette) plus exported helpers `inchesToPoints` and `pointsToInches`.
- `src/export/pdf-utils.js` (or similar):
    - `normalizeDashboardForExport(rawData)` → `{ clientName, weekLabel, palette, days: DayExport[] }`.
    - `dataUrlToUint8Array(dataUrl)` → `Uint8Array` for embedding images.
    - `deriveMealSummary(day)` → aggregated percentages using the existing `aggregateDay`.
- `src/export/pdf-composer.js`:
    - Exports `async function renderDashboardPdf(rawData)`, which internally creates a `PDFDocument`, embeds fonts, draws header/legend/grid, and returns `{ blob, meta }`.
    - Contains helpers `drawHeader(doc, page, model)`, `drawLegend(...)`, `drawDayColumn(...)`, `drawMealCard(...)`, and `drawDonut(...)`.
- `src/main.js`:
    - Replace `createExportButton` so it awaits `renderDashboardPdf`.
    - Update `exportPreviewState` to store `pdfUrl`, `blob`, and `meta`.
    - Adjust `openExportPreview`, `renderExportPreview`, and `handleExportSave` to handle PDF blobs instead of PNG data URLs.
    - Remove the now-unused PNG snapshot helpers and the `html-to-image` import once the PDF flow is stable.
- `src/style.css`: tweak `.export-preview` and related classes for the PDF viewer placeholder plus any buttons renamed in the new flow.
- `README.md`: rewrite the Export section and add instructions for printing the PDF (mention the guaranteed header/legend layout and seven columns).

Note (2025-11-10 22:31Z): Initial version of this ExecPlan, created to capture the new requirement for a deterministic, print-ready PDF export with a prescribed header, legend placement, and seven-day grid.
