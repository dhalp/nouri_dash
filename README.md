# Emily's Dashboard

Automated workflow that uses the OpenAI Responses API to transform raw meal notes or photos into a weekly dashboard that matches the reference layout (`img_456`). The generator script orchestrates the provided nutrition prompts, produces structured data (JSON + generated assets), and the frontend renders an exportable dashboard that can be downloaded as a print-ready PDF.

## Prerequisites

- Node.js 18+
- An OpenAI API key with access to the Responses API (`OPENAI_API_KEY`)
- Meal descriptions or image files for the week

## Install

```bash
npm install
```

> If you are running in a restricted environment, install dependencies on a machine with network access before executing the generator.

## Populate data

### Option 1: Use the in-app wizard (no coding)

1. Run `npm run dev` and open `http://localhost:5173`.
2. Click **Open Data Wizard** at the top-right of the dashboard.
3. Paste your OpenAI API key into the **OpenAI API Key** card, press **Save key**, and confirm the “saved locally” message (the key only lives in this browser).
4. Provide client/week details, and add meals (text or photos) for each day.
5. Hit **Build Dashboard Data**. The wizard pipes every meal through the Meal Breakdown prompt, optionally runs the Picture Generation prompt, and swaps the live dashboard to the freshly generated data.
6. Use **Download JSON** to export the structured output if you want to reuse it later, or switch to **Print Layout** when you’re ready for a client-facing board/PDF.

The wizard keeps the provided prompts intact, shows progress for each meal, and stores the latest breakdown inside the session so you can tweak percentages without re-entering everything.

### Option 2: Work from a JSON file

Edit `data/input.json`. The file ships with an empty scaffold; use `data/input.example.json` as a reference. Each meal supports either plain text or an image path relative to the project root.

```jsonc
{
  "clientName": "Maria",
  "weekLabel": "tracked meals",
  "startDate": "2024-07-01",
  "generateImages": true,
  "days": [
    {
      "label": "Day 1",
      "meals": [
        {
          "id": "day1-breakfast",
          "title": "Fruit Plate",
          "source": {
            "type": "text",
            "value": "Strawberries, blueberries, diced mango, and banana slices with yogurt."
          }
        }
      ]
    }
  ]
}
```

- `source.type: "text"` sends the description to the prompts.
- `source.type: "image"` reads `source.path` (relative or absolute) and attaches the image.
- Set `"generateImages": false` to skip the picture-generation call and reuse original photos.

## Generate dashboard data

```bash
OPENAI_API_KEY=sk-your-key npm run generate
```

The script:

1. Calls the **Meal Breakdown Prompt** with `response_format: json_schema` to capture structured percentages (`vegFruit`, `protein`, `healthyCarbs`, `pauseFood`) plus coaching notes.
2. Calls the **Picture Generation Prompt** (modalities: text + image) to create standardized 4:5 assets that obey the Pause background rules.
3. Saves the results as:
   - `public/data/dashboard-data.json` – canonical weekly data + color palette.
   - `public/generated/*.png` – rendered meal tiles.

Generation is resumable; rerun after tweaking meals or prompts. Existing assets with the same slug are replaced.

## Preview the dashboard

```bash
npm run dev
```

Open `http://localhost:5173`. The page replicates the layout from `img_456`, including:

- Weekly donut per day built from conic gradients.
- Meal tiles with left-side proportion bars and right-side connectors.
- Legend with brand marks and emoji substitutes for the broccoli/chicken/bread/pause icons.

Use **Print Layout** whenever you need a quick browser-to-PDF export. That button swaps the app into a full-bleed, button-free view sized for letter landscape pages, automatically hides overlays, and labels empty tiles as “meal not provided.” Once in that mode press Cmd+P/Ctrl+P and print/save at 100%—no manual 75% scaling required. (If you forget to hit the button first, the page still auto-snapshots into the same layout during `beforeprint`.)

Need just a quick shareable card? While you’re in Print Layout, click the floating helper bubble to capture the current board as a fixed 10" × 6.25" PDF card. The app renders the on-screen layout to an image, centers it on the card canvas, and downloads it instantly—perfect for email or social updates.

If you still need the deterministic vector composer for a perfectly aligned PDF, run `npm run test:export`; the CLI version renders the same 11" × 8.5" layout and saves it to `dist/sample-dashboard.pdf`. **Download JSON** continues to pull the current dataset (including in-browser runs from the wizard).

### Validate the export layout

The PDF composer now has its own regression check. Run:

```bash
npm run test:export
```

This script renders `data/dashboard-sample.json`, saves `dist/sample-dashboard.pdf`, and verifies that the stacked header, legend, and all seven day columns fit within the printable body height. Open the generated file to spot-check typography or share it with reviewers without booting the browser.

### Drag-and-drop grading

With the dev server running, you can drag a meal photo from your desktop straight onto any of the square meal tiles in the dashboard. The tile will show a spinner while the image is sent through the same OpenAI Responses API prompt that powers the wizard; once grading completes the photo stays in place, the Always/Fuel/Pause bars update, and that day's donut reflects the new percentages. Use the dedicated **OpenAI API Key** card (inside the wizard) to save your key once so drag-and-drop grading has credentials, and use **Download JSON** if you want to persist the graded meals.

### Production build

```bash
npm run build
npm run preview
```

## Key files

- `scripts/generate-dashboard.js` – Orchestrates API calls, data normalization, and asset output.
- `scripts/validate-export-layout.js` – CLI check that generates a sample PDF and asserts the layout fits on a letter landscape page.
- `scripts/prompts.js` – Verbatim copies of the provided nutrition + picture prompts.
- `src/main.js` & `src/style.css` – Render logic and styling that mirror the provided reference.
- `src/export/pdf-composer.js` – Pure-PDF renderer that builds the seven-column export layout.
- `public/data/dashboard-data.json` – Generated runtime data (created during `npm run generate`).
- `data/dashboard-sample.json` – Sample dashboard data that powers the export validation script.

## Troubleshooting

- **404 on `/data/dashboard-data.json`** – Run the generator; until then the UI falls back to placeholder data.
- **Export button fails** – Ensure all images resolve (hosted locally via Vite) and try again; console logs include failure details.
- **API errors** – Double-check `OPENAI_API_KEY` and that the account has access to the Responses endpoints used (`gpt-4.1-mini`).

Feel free to customize fonts, iconography, or layout variables in `src/style.css` to further match bespoke branding while keeping the prompt-driven workflow intact.
