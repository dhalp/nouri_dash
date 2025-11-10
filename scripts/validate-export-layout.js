import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDashboardPdf } from '../src/export/pdf-composer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const SAMPLE_PATH = path.join(ROOT_DIR, 'data', 'dashboard-sample.json');
const OUTPUT_PATH = path.join(ROOT_DIR, 'dist', 'sample-dashboard.pdf');

async function main() {
  const raw = await readFile(SAMPLE_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const { blob, meta } = await renderDashboardPdf(data);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const buffer = Buffer.from(await blob.arrayBuffer());
  await writeFile(OUTPUT_PATH, buffer);

  const cardStackHeight = meta.cardHeightPt * meta.mealSlots + meta.cardGapPt * (meta.mealSlots - 1);
  const totalColumnUsage = meta.labelBlockPt + meta.donutBlockPt + cardStackHeight;
  if (totalColumnUsage - meta.bodyHeightPt > 1) {
    throw new Error(
      `Column layout exceeds printable height by ${(totalColumnUsage - meta.bodyHeightPt).toFixed(2)}pt`
    );
  }

  console.log('PDF saved to', OUTPUT_PATH);
  console.log('Layout check', {
    bodyHeightPt: meta.bodyHeightPt.toFixed(2),
    totalColumnUsage: totalColumnUsage.toFixed(2),
    cardHeightPt: meta.cardHeightPt.toFixed(2),
    donutRadiusPt: meta.donutRadiusPt.toFixed(2)
  });
}

main().catch((error) => {
  console.error('Export validation failed:', error);
  process.exitCode = 1;
});
