import { MEAL_BREAKDOWN_PROMPT, PICTURE_GENERATION_PROMPT } from '../scripts/prompts.js';
import { renderDashboardPdf } from './export/pdf-composer.js';
import './style.css';

const DEFAULT_DATA = {
  clientName: 'Maria',
  weekLabel: 'tracked meals',
  palette: {
    vegFruit: '#4fa742',
    healthyCarbs: '#f5d957',
    protein: '#f59f1a',
    pauseFood: '#f2899a',
    neutral: '#d2d2d2',
    canvasBg: '#ffffff'
  },
  days: Array.from({ length: 7 }, (_, index) => ({
    label: `Day ${index + 1}`,
    summary: {
      vegFruit: 0,
      healthyCarbs: 0,
      protein: 0,
      pauseFood: 0
    },
    meals: []
  }))
};

const CATEGORY_KEYS = [
  { key: 'vegFruit', label: 'Always Food', emoji: '🥦' },
  { key: 'protein', label: 'Fuel Food · Protein', emoji: '🍗' },
  { key: 'healthyCarbs', label: 'Fuel Food · Whole Grain', emoji: '🍞' },
  { key: 'pauseFood', label: 'Pause Food', emoji: '⏸️' }
];

const VIEW_MODES = {
  interactive: 'interactive',
  print: 'print'
};

const mealBreakdownSchema = {
  name: 'meal_breakdown',
  schema: {
    type: 'object',
    properties: {
      vegFruit: { type: 'number', description: 'Percent Veg & Fruit (0-100).' },
      healthyCarbs: { type: 'number', description: 'Percent Healthy Carbs (0-100).' },
      protein: { type: 'number', description: 'Percent Protein (0-100).' },
      pauseFood: { type: 'number', description: 'Percent Pause Food (0-100).' },
      summary: { type: 'string', description: '1-2 sentences summarizing the reasoning.' },
      adjustmentTips: {
        type: 'string',
        description: 'Specific tip for balancing the meal closer to Fuel foods.'
      }
    },
    required: ['vegFruit', 'healthyCarbs', 'protein', 'pauseFood', 'summary', 'adjustmentTips'],
    additionalProperties: false
  }
};

const API_KEY_STORAGE_KEY = 'emily-dashboard:openai-key';

const appState = {
  dashboardData: structuredClone(DEFAULT_DATA),
  formData: createInitialFormState(),
  isUploaderOpen: false,
  isGenerating: false,
  generationStatus: { message: '', progress: 0 },
  lastLoadedFromFile: false,
  tileUploads: {},
  apiKeyDraft: '',
  apiKeyStatus: { type: 'idle', message: '' },
  isApiKeyVisible: false,
  viewMode: VIEW_MODES.interactive
};

const exportPreviewState = {
  isOpen: false,
  blob: null,
  url: '',
  filename: '',
  meta: null,
  isSaving: false,
  error: ''
};

const uploaderOverlay = createUploaderOverlay();
const exportPreviewOverlay = createExportPreviewOverlay();
const printModeHint = createPrintModeHint();
let printModeForcedByBrowser = false;

function getTileKey(dayIndex, slotIndex) {
  return `${dayIndex}:${slotIndex}`;
}

function ensureDashboardDay(dayIndex) {
  if (!Array.isArray(appState.dashboardData.days)) {
    appState.dashboardData.days = structuredClone(DEFAULT_DATA.days);
  }
  if (!appState.dashboardData.days[dayIndex]) {
    appState.dashboardData.days[dayIndex] = {
      label: `Day ${dayIndex + 1}`,
      summary: {
        vegFruit: 0,
        healthyCarbs: 0,
        protein: 0,
        pauseFood: 0
      },
      meals: []
    };
  } else if (!Array.isArray(appState.dashboardData.days[dayIndex].meals)) {
    appState.dashboardData.days[dayIndex].meals = [];
  }
  if (!appState.dashboardData.days[dayIndex].summary) {
    appState.dashboardData.days[dayIndex].summary = aggregateDay([]);
  }
  return appState.dashboardData.days[dayIndex];
}

function normalizeDayMeals(day) {
  if (!Array.isArray(day.meals)) {
    day.meals = [];
    return;
  }
  let last = day.meals.length - 1;
  while (last >= 0 && !day.meals[last]) {
    last -= 1;
  }
  day.meals = day.meals.slice(0, last + 1);
}

function setDashboardMeal(dayIndex, slotIndex, meal) {
  const day = ensureDashboardDay(dayIndex);
  day.meals[slotIndex] = meal;
  normalizeDayMeals(day);
}

function clearDashboardMeal(dayIndex, slotIndex) {
  const day = ensureDashboardDay(dayIndex);
  if (slotIndex in day.meals) {
    delete day.meals[slotIndex];
    normalizeDayMeals(day);
  }
  recomputeDaySummary(dayIndex);
}

function recomputeDaySummary(dayIndex) {
  const day = ensureDashboardDay(dayIndex);
  const completedMeals = (day.meals ?? []).filter((meal) => meal && meal.breakdown && !meal.pending);
  day.summary = aggregateDay(completedMeals);
}

function getTileUploadState(key) {
  return appState.tileUploads[key];
}

function setTileUploadState(key, value) {
  if (!value) {
    delete appState.tileUploads[key];
  } else {
    appState.tileUploads[key] = value;
  }
}

function formatFilenameTitle(fileName) {
  if (!fileName) return '';
  return fileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

function deriveMealTitle(dayIndex, slotIndex, fileName) {
  const fromFile = formatFilenameTitle(fileName);
  if (fromFile) return fromFile;
  return `Day ${dayIndex + 1} meal ${slotIndex + 1}`;
}

function structuredClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createInitialFormState() {
  return {
    apiKey: '',
    clientName: DEFAULT_DATA.clientName,
    weekLabel: DEFAULT_DATA.weekLabel,
    startDate: '',
    generateImages: true,
    days: Array.from({ length: 7 }, (_, index) => ({
      id: `day-${index + 1}`,
      label: `Day ${index + 1}`,
      meals: []
    }))
  };
}

function createEmptyMeal(type = 'text') {
  return {
    id: crypto.randomUUID(),
    title: '',
    type,
    text: '',
    caption: '',
    file: null,
    fileMimeType: '',
    fileDataUrl: '',
    fileBase64: '',
    lastBreakdown: null,
    generatedImageDataUrl: ''
  };
}

function createUploaderOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'meal-uploader-overlay';
  overlay.className = 'uploader-overlay';
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appState.isUploaderOpen && !appState.isGenerating) {
      closeUploader();
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function createExportPreviewOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'export-preview-overlay';
  overlay.className = 'export-preview-overlay';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && !exportPreviewState.isSaving) {
      closeExportPreview();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && exportPreviewState.isOpen && !exportPreviewState.isSaving) {
      closeExportPreview();
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function createPrintModeHint() {
  const hint = document.createElement('div');
  hint.className = 'print-mode-hint';
  hint.innerHTML =
    '<strong>Print layout ready.</strong> Press Cmd+P (Mac) or Ctrl+P (Windows) to open the print dialog, then save as PDF. Press Esc to return to the interactive view.';
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appState.viewMode === VIEW_MODES.print) {
      event.preventDefault();
      exitPrintMode();
    }
  });
  window.addEventListener('beforeprint', () => {
    if (appState.viewMode !== VIEW_MODES.print) {
      printModeForcedByBrowser = true;
      enterPrintMode({ silent: true });
    }
  });
  window.addEventListener('afterprint', () => {
    if (printModeForcedByBrowser) {
      printModeForcedByBrowser = false;
      exitPrintMode();
    }
  });
  document.body.appendChild(hint);
  return hint;
}

function updatePrintModeHint(isPrintMode) {
  if (!printModeHint) return;
  printModeHint.classList.toggle('is-visible', Boolean(isPrintMode));
}

function enterPrintMode({ silent = false } = {}) {
  if (appState.viewMode === VIEW_MODES.print) return;
  appState.viewMode = VIEW_MODES.print;
  renderDashboard();
  if (!silent) {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
    });
  }
}

function exitPrintMode() {
  if (appState.viewMode !== VIEW_MODES.print) return;
  appState.viewMode = VIEW_MODES.interactive;
  renderDashboard();
}

function supportsSaveFilePicker() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

function openExportPreview({ blob, filename, meta }) {
  if (exportPreviewState.url) {
    URL.revokeObjectURL(exportPreviewState.url);
  }
  exportPreviewState.isOpen = true;
  exportPreviewState.blob = blob;
  exportPreviewState.url = blob ? URL.createObjectURL(blob) : '';
  exportPreviewState.filename = filename;
  exportPreviewState.meta = meta ?? null;
  exportPreviewState.error = '';
  exportPreviewState.isSaving = false;
  renderExportPreview();
}

function closeExportPreview() {
  if (exportPreviewState.isSaving) {
    return;
  }
  if (exportPreviewState.url) {
    URL.revokeObjectURL(exportPreviewState.url);
  }
  exportPreviewState.isOpen = false;
  exportPreviewState.url = '';
  exportPreviewState.blob = null;
  exportPreviewState.filename = '';
  exportPreviewState.meta = null;
  exportPreviewState.error = '';
  renderExportPreview();
}

function renderExportPreview() {
  if (!exportPreviewOverlay) return;
  exportPreviewOverlay.classList.toggle('is-open', exportPreviewState.isOpen);
  exportPreviewOverlay.innerHTML = '';
  if (!exportPreviewState.isOpen) {
    return;
  }

  const pickerSupported = supportsSaveFilePicker();
  const panel = el('div', { className: 'export-preview' });

  const header = el('div', { className: 'export-preview__header' });
  header.appendChild(el('h2', { className: 'export-preview__title', text: 'Export preview' }));
  const closeButton = el('button', {
    className: 'export-preview__close',
    html: '&times;',
    attrs: { type: 'button', 'aria-label': 'Close export preview' }
  });
  closeButton.disabled = exportPreviewState.isSaving;
  closeButton.addEventListener('click', closeExportPreview);
  header.appendChild(closeButton);
  panel.appendChild(header);

  const body = el('div', { className: 'export-preview__body' });
  const previewFigure = el('div', { className: 'export-preview__figure' });
  if (exportPreviewState.url) {
    const frame = document.createElement('iframe');
    frame.className = 'export-preview__frame';
    frame.src = exportPreviewState.url;
    frame.title = 'PDF preview';
    frame.loading = 'lazy';
    frame.setAttribute('aria-label', 'PDF preview');
    previewFigure.appendChild(frame);
  } else {
    previewFigure.appendChild(
      el('p', {
        className: 'export-preview__placeholder',
        text: 'PDF ready to download.'
      })
    );
  }
  body.appendChild(previewFigure);

  const details = el('div', { className: 'export-preview__details' });
  const filenameField = el('label', { className: 'export-preview__label', text: 'File name' });
  const filenameInput = document.createElement('input');
  filenameInput.type = 'text';
  filenameInput.value = exportPreviewState.filename || '';
  filenameInput.placeholder = 'tracked-meals.png';
  filenameInput.autocomplete = 'off';
  filenameInput.disabled = exportPreviewState.isSaving;
  filenameInput.addEventListener('input', (event) => {
    exportPreviewState.filename = event.target.value;
  });
  filenameField.appendChild(filenameInput);
  details.appendChild(filenameField);

  if (exportPreviewState.meta) {
    details.appendChild(
      el('p', {
        className: 'export-preview__meta',
        text: buildExportMetaLine(exportPreviewState.meta)
      })
    );
  }

  details.appendChild(
    el('p', {
      className: 'export-preview__note',
      text:
        'This export is a vector PDF sized for letter landscape (≈11" × 8.5"), with margins baked in so you can print without extra tweaks.'
    })
  );

  if (!pickerSupported) {
    details.appendChild(
      el('p', {
        className: 'export-preview__note export-preview__note--warning',
        text: 'Save As requires a Chromium-based browser. Use Download if your browser does not support the file picker.'
      })
    );
  }

  if (exportPreviewState.error) {
    details.appendChild(
      el('p', {
        className: 'export-preview__error',
        text: exportPreviewState.error
      })
    );
  }

  body.appendChild(details);
  panel.appendChild(body);

  const footer = el('div', { className: 'export-preview__footer' });
  const buttons = el('div', { className: 'export-preview__buttons' });

  const saveAsButton = createActionButton({
    text: exportPreviewState.isSaving ? 'Saving…' : 'Save As…',
    variant: 'primary',
    onClick: () => handleExportSave(true)
  });
  saveAsButton.disabled = exportPreviewState.isSaving || !pickerSupported;
  buttons.appendChild(saveAsButton);

  const downloadButton = createActionButton({
    text: exportPreviewState.isSaving ? 'Working…' : 'Download',
    onClick: () => handleExportSave(false)
  });
  downloadButton.disabled = exportPreviewState.isSaving;
  buttons.appendChild(downloadButton);

  const cancelButton = el('button', {
    className: 'tertiary-button export-preview__cancel',
    text: 'Cancel',
    attrs: { type: 'button' }
  });
  cancelButton.disabled = exportPreviewState.isSaving;
  cancelButton.addEventListener('click', closeExportPreview);

  footer.appendChild(buttons);
  footer.appendChild(cancelButton);
  panel.appendChild(footer);

  exportPreviewOverlay.appendChild(panel);
}

function buildExportMetaLine(meta) {
  if (!meta || (!meta.widthPt && !meta.widthIn) || (!meta.heightPt && !meta.heightIn)) return '';
  const fallbackDpi = meta.dpi || 72;
  const widthInches = (meta.widthIn ?? meta.widthPt / fallbackDpi).toFixed(2).replace(/\.00$/, '');
  const heightInches = (meta.heightIn ?? meta.heightPt / fallbackDpi).toFixed(2).replace(/\.00$/, '');
  let line = `${widthInches}" × ${heightInches}" landscape PDF`;
  if (meta.dpi) {
    line += ` · internal grid ${meta.dpi} DPI`;
  }
  if (meta.columnWidthPt || meta.columnWidthIn) {
    const columnInches = (meta.columnWidthIn ?? meta.columnWidthPt / fallbackDpi).toFixed(2).replace(/\.00$/, '');
    line += ` · column width ≈ ${columnInches}"`;
  }
  return line;
}

function sanitizeFileName(input) {
  const fallback = 'tracked-meals';
  if (!input) return fallback;
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  const withoutInvalid = trimmed.replace(/[\\/:*?"<>|]+/g, '-');
  const collapsed = withoutInvalid.replace(/\s+/g, '-').replace(/-+/g, '-');
  const cleaned = collapsed.replace(/^-+|-+$/g, '');
  return (cleaned || fallback).toLowerCase();
}

function ensurePdfExtension(name) {
  if (!name) return 'tracked-meals.pdf';
  const trimmed = name.trim();
  if (!trimmed) return 'tracked-meals.pdf';
  const withoutExtension = trimmed.replace(/\.pdf$/i, '');
  return `${withoutExtension}.pdf`;
}

function buildExportFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `tracked-meals-${timestamp}.pdf`;
}

async function handleExportSave(preferPicker = false) {
  if (!exportPreviewState.blob) return;
  if (preferPicker && !supportsSaveFilePicker()) {
    exportPreviewState.error = 'Save As is unavailable in this browser. Please use Download instead.';
    renderExportPreview();
    return;
  }

  exportPreviewState.isSaving = true;
  exportPreviewState.error = '';
  renderExportPreview();

  try {
    const sanitized = sanitizeFileName(exportPreviewState.filename);
    const filename = ensurePdfExtension(sanitized);
    if (preferPicker) {
      await saveBlobWithPicker(exportPreviewState.blob, filename);
    } else {
      await triggerBlobDownload(exportPreviewState.blob, filename);
    }
    closeExportPreview();
  } catch (error) {
    if (error?.name === 'AbortError') {
      exportPreviewState.isSaving = false;
      renderExportPreview();
      return;
    }
    console.error('Saving export failed', error);
    exportPreviewState.error = error?.message || 'Unable to save the exported file.';
    exportPreviewState.isSaving = false;
    renderExportPreview();
  }
}

async function saveBlobWithPicker(blob, filename) {
  const handle = await window.showSaveFilePicker({
    suggestedName: filename,
    types: [
      {
        description: 'PDF Document',
        accept: { 'application/pdf': ['.pdf'] }
      }
    ]
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('localStorage is not accessible', error);
    return null;
  }
}

function restoreSavedApiKey() {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const stored = storage.getItem(API_KEY_STORAGE_KEY);
    if (stored) {
      appState.formData.apiKey = stored;
      appState.apiKeyDraft = stored;
      appState.apiKeyStatus = { type: 'success', message: 'API key restored from this browser.' };
    }
  } catch (error) {
    console.warn('Unable to read saved API key', error);
  }
}

function persistApiKey(value) {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    if (value) {
      storage.setItem(API_KEY_STORAGE_KEY, value);
    } else {
      storage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Unable to persist API key', error);
  }
}

function setApiKeyStatus(type, message) {
  appState.apiKeyStatus = { type, message };
}

function handleApiKeySave() {
  const trimmed = appState.apiKeyDraft?.trim();
  if (!trimmed) {
    setApiKeyStatus('error', 'Enter your OpenAI API key before saving.');
    renderUploader();
    return;
  }
  appState.apiKeyDraft = trimmed;
  appState.formData.apiKey = trimmed;
  persistApiKey(trimmed);
  setApiKeyStatus('success', 'API key saved to this browser.');
  renderUploader();
}

function handleApiKeyClear() {
  appState.apiKeyDraft = '';
  appState.formData.apiKey = '';
  persistApiKey('');
  setApiKeyStatus('info', 'Saved API key cleared.');
  renderUploader();
}

function kebabCase(input) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function el(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  const { className, text, html, attrs = {} } = options;
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (html !== undefined) element.innerHTML = html;
  Object.entries(attrs).forEach(([attr, value]) => {
    if (value !== undefined && value !== null) {
      element.setAttribute(attr, value);
    }
  });
  const append = Array.isArray(children) ? children : [children];
  append.filter(Boolean).forEach((child) => element.appendChild(child));
  return element;
}

async function loadDashboardData() {
  try {
    const response = await fetch('/data/dashboard-data.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    appState.dashboardData = data;
    appState.tileUploads = {};
    appState.formData.clientName = data.clientName ?? appState.formData.clientName;
    appState.formData.weekLabel = data.weekLabel ?? appState.formData.weekLabel;
  } catch (error) {
    console.warn('Falling back to sample data. Run the generator or use the uploader to populate real data.', error);
    appState.dashboardData = structuredClone(DEFAULT_DATA);
    appState.tileUploads = {};
  }
}

function applyPalette(palette) {
  if (!palette) return;
  const root = document.documentElement;
  Object.entries(palette).forEach(([key, value]) => {
    if (value) {
      root.style.setProperty(`--${kebabCase(key)}`, value);
    }
  });
}

function formatTitle(clientName, weekLabel) {
  const sanitized = clientName?.trim() || 'Maria';
  const trailingApostrophe = sanitized.endsWith('s') || sanitized.endsWith('S') ? `'` : `'s`;
  return [`${sanitized}${trailingApostrophe}`, weekLabel || 'tracked meals'];
}

function buildDataUrl(base64, mimeType = 'image/png') {
  if (!base64) return '';
  return `data:${mimeType};base64,${base64}`;
}

function extractJsonSchemaOutput(result) {
  if (!result) return null;
  const outputs = Array.isArray(result.output) ? result.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (content?.type === 'output_json' && content.json) {
        return content.json;
      }
      if (content?.type === 'json_schema' && content.json) {
        return content.json;
      }
      if (content?.type === 'output_text' && content.text) {
        const text =
          Array.isArray(content.text) && content.text.length
            ? content.text.join('')
            : String(content.text ?? '');
        if (text.trim()) {
          try {
            return JSON.parse(text);
          } catch (error) {
            console.warn('Failed to parse output_text as JSON', error);
          }
        }
      }
    }
  }
  if (Array.isArray(result.output_text) && result.output_text.length) {
    const joined = result.output_text.join('').trim();
    if (joined) {
      try {
        return JSON.parse(joined);
      } catch (error) {
        console.warn('Failed to parse output_text array as JSON', error);
      }
    }
  } else if (typeof result.output_text === 'string' && result.output_text.trim()) {
    try {
      return JSON.parse(result.output_text);
    } catch (error) {
      console.warn('Failed to parse output_text string as JSON', error);
    }
  }
  return null;
}

function createLegend(palette) {
  const legend = el('div', { className: 'legend' });
  const donut = el('div', {
    className: 'legend__donut'
  });
  donut.style.setProperty(
    '--donut-fill',
    `conic-gradient(from -90deg, ${[
      `${palette.vegFruit} 0 90deg`,
      `${palette.protein} 90deg 180deg`,
      `${palette.healthyCarbs} 180deg 270deg`,
      `${palette.pauseFood} 270deg 360deg`
    ].join(', ')})`
  );
  legend.appendChild(donut);

  const list = el('ul', { className: 'legend__items' });
  CATEGORY_KEYS.forEach(({ key, label, emoji }) => {
    const item = el('li', { className: 'legend__item' });
    const swatch = el('span', {
      className: `legend__swatch legend__swatch--${kebabCase(key)}`,
      attrs: { 'aria-hidden': 'true' }
    });
    const text = el('span', { className: 'legend__text', text: label });
    const glyph = el('span', { className: 'legend__icon', text: emoji });
    item.append(swatch, text, glyph);
    list.appendChild(item);
  });

  legend.appendChild(list);
  const brand = el('div', { className: 'legend__brand', text: 'n' });
  legend.appendChild(brand);
  return legend;
}

function buildDonutGradient(summary, palette) {
  const total =
    (summary?.vegFruit ?? 0) +
    (summary?.healthyCarbs ?? 0) +
    (summary?.protein ?? 0) +
    (summary?.pauseFood ?? 0);
  if (!total) {
    return `conic-gradient(from -90deg, ${palette.vegFruit} 0 90deg, ${palette.protein} 90deg 180deg, ${palette.healthyCarbs} 180deg 270deg, ${palette.pauseFood} 270deg 360deg)`;
  }

  const segments = [
    { value: summary.vegFruit, color: palette.vegFruit },
    { value: summary.protein, color: palette.protein },
    { value: summary.healthyCarbs, color: palette.healthyCarbs },
    { value: summary.pauseFood, color: palette.pauseFood }
  ];

  let current = 0;
  const stops = segments
    .map((segment) => {
      const start = current;
      const delta = ((segment.value ?? 0) / total) * 360;
      current += delta;
      return `${segment.color} ${start}deg ${current}deg`;
    })
    .join(', ');
  return `conic-gradient(from -90deg, ${stops})`;
}

function createDonut(summary, palette) {
  const donut = el('div', { className: 'donut' });
  donut.style.setProperty('--donut-fill', buildDonutGradient(summary, palette));
  const ring = el('div', { className: 'donut__ring' }, [donut]);
  return ring;
}

function buildAllocationBar(breakdown) {
  const wrapper = el('div', { className: 'meal-allocation' });
  if (!breakdown) return wrapper;

  const values = [
    { className: 'veg-fruit', value: breakdown.vegFruit },
    { className: 'protein', value: breakdown.protein },
    { className: 'healthy-carbs', value: breakdown.healthyCarbs },
    { className: 'pause-food', value: breakdown.pauseFood }
  ].map((segment) => ({
    ...segment,
    value: Math.max(segment.value || 0, 0)
  }));

  const total = values.reduce((acc, segment) => acc + segment.value, 0);
  const lastFilledIndex = values.reduce(
    (lastIndex, segment, index) => (segment.value > 0 ? index : lastIndex),
    -1
  );

  let assigned = 0;
  values.forEach((segment, index) => {
    let percentage = 0;
    if (total > 0 && segment.value > 0) {
      const remaining = Math.max(0, 100 - assigned);
      if (index === lastFilledIndex) {
        percentage = remaining;
      } else {
        percentage = Math.min((segment.value / total) * 100, remaining);
      }
      assigned = Math.min(100, assigned + percentage);
    }

    const bar = el('span', {
      className: `meal-allocation__segment meal-allocation__segment--${segment.className}`
    });
    bar.style.flexBasis = `${percentage}%`;
    wrapper.appendChild(bar);
  });

  return wrapper;
}

function createPlaceholderCard({ dayIndex, slotIndex, isPrintMode = false, emptyLabel = '' }) {
  const card = el('article', {
    className: 'meal-card meal-card--placeholder',
    attrs: {
      'data-day-index': String(dayIndex),
      'data-slot-index': String(slotIndex)
    }
  });
  const allocation = buildAllocationBar({ vegFruit: 0, healthyCarbs: 0, protein: 0, pauseFood: 0 });
  const frame = el('figure', { className: 'meal-card__frame' });
  frame.appendChild(
    el('div', {
      className: 'meal-card__placeholder',
      text: emptyLabel
    })
  );
  const connector = el('div', { className: 'meal-card__connector' });
  card.append(allocation, frame, connector);
  if (!isPrintMode) {
    attachTileDrop(card, frame, { dayIndex, slotIndex, meal: null });
  }
  return card;
}

function createMealCard({ meal, palette, dayIndex, slotIndex, isPrintMode = false }) {
  if (!meal) {
    return createPlaceholderCard({
      dayIndex,
      slotIndex,
      isPrintMode,
      emptyLabel: isPrintMode ? 'meal not provided' : ''
    });
  }

  const breakdown = meal?.breakdown ?? {
    vegFruit: 0,
    healthyCarbs: 0,
    protein: 0,
    pauseFood: 0,
    summary: ''
  };

  const card = el('article', {
    className: 'meal-card',
    attrs: {
      'data-meal-id': meal?.id ?? '',
      'data-day-index': String(dayIndex),
      'data-slot-index': String(slotIndex)
    }
  });

  const allocation = buildAllocationBar(breakdown);
  const imageContainer = el('figure', { className: 'meal-card__frame' });
  let visual;

  if (meal?.generatedImageDataUrl) {
    visual = el('img', {
      className: 'meal-card__image',
      attrs: {
        src: meal.generatedImageDataUrl,
        alt: meal.title ?? 'Meal photo'
      }
    });
  } else if (meal?.generatedImageFile) {
    const normalized = meal.generatedImageFile.startsWith('/')
      ? meal.generatedImageFile
      : `/${meal.generatedImageFile}`;
    visual = el('img', {
      className: 'meal-card__image',
      attrs: {
        src: normalized,
        alt: meal.title ?? 'Meal photo'
      }
    });
  } else if (meal?.source?.type === 'image' && meal.source.path) {
    const localPath = meal.source.path.startsWith('/generated/')
      ? meal.source.path
      : `/${meal.source.path.replace(/^public\//, '')}`;
    visual = el('img', {
      className: 'meal-card__image',
      attrs: {
        src: localPath,
        alt: meal.title ?? 'Meal photo'
      }
    });
  } else if (meal?.source?.type === 'inline-image' && meal.source.dataUrl) {
    visual = el('img', {
      className: 'meal-card__image',
      attrs: {
        src: meal.source.dataUrl,
        alt: meal.title ?? 'Meal photo'
      }
    });
  } else {
    visual = el('div', {
      className: 'meal-card__placeholder',
      text: meal?.title ?? 'Meal'
    });
  }
  imageContainer.appendChild(visual);
  const caption = el('figcaption', {
    className: 'sr-only',
    text: meal?.title ?? 'Meal'
  });
  imageContainer.appendChild(caption);

  const connectors = el('div', { className: 'meal-card__connector' });

  card.append(allocation, imageContainer, connectors);
  card.style.setProperty('--veg-fruit', palette.vegFruit);
  card.style.setProperty('--protein', palette.protein);
  card.style.setProperty('--healthy-carbs', palette.healthyCarbs);
  card.style.setProperty('--pause-food', palette.pauseFood);
  card.title = meal.pending ? 'Analyzing photo…' : breakdown.summary ?? '';
  if (!isPrintMode) {
    attachTileDrop(card, imageContainer, { dayIndex, slotIndex, meal });
  }
  return card;
}

function createDayColumn({ day, dayIndex, palette, isPrintMode = false }) {
  const dayLabel = day?.label ?? `Day ${dayIndex + 1}`;
  const column = el('section', { className: 'day-column' });
  column.appendChild(el('h2', { className: 'day-column__title', text: dayLabel }));

  const donut = createDonut(day?.summary ?? { vegFruit: 0, healthyCarbs: 0, protein: 0, pauseFood: 0 }, palette);
  column.appendChild(donut);

  const mealsWrapper = el('div', { className: 'day-column__meals' });
  const meals = day?.meals ?? [];
  const targetCount = Math.max(meals.length, 3);
  for (let i = 0; i < targetCount; i += 1) {
    const meal = meals[i] ?? null;
    mealsWrapper.appendChild(
      createMealCard({
        meal,
        palette,
        dayIndex,
        slotIndex: i,
        isPrintMode
      })
    );
  }
  column.appendChild(mealsWrapper);
  return column;
}

function attachTileDrop(card, dropTarget, { dayIndex, slotIndex, meal }) {
  const frame = dropTarget ?? card;
  const key = getTileKey(dayIndex, slotIndex);
  card.classList.add('meal-card--droppable');

  const overlay = el('div', {
    className: 'meal-card__drop-overlay',
    attrs: { 'aria-hidden': 'true' }
  });
  const spinner = el('div', {
    className: 'meal-card__spinner',
    attrs: { 'aria-hidden': 'true' }
  });
  const label = el('span', { className: 'meal-card__drop-label' });
  overlay.append(spinner, label);
  frame.appendChild(overlay);
  if (!meal) {
    overlay.classList.add('show-hint');
  }

  const uploadState = getTileUploadState(key);
  const isProcessing = Boolean(uploadState || (meal && meal.pending));
  if (isProcessing) {
    label.textContent = uploadState?.message ?? 'Grading…';
    overlay.classList.add('is-visible');
    card.classList.add('meal-card--processing');
  } else {
    label.textContent = meal ? 'Drop to re-grade' : 'Drop image to grade';
  }

  function resetDragState() {
    card.classList.remove('meal-card--dragover');
  }

  frame.addEventListener('dragenter', (event) => {
    event.preventDefault();
    card.classList.add('meal-card--dragover');
  });
  frame.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  frame.addEventListener('dragleave', (event) => {
    event.preventDefault();
    resetDragState();
  });
  frame.addEventListener('drop', (event) => {
    resetDragState();
    handleTileDrop(event, dayIndex, slotIndex);
  });
}

function handleTileDrop(event, dayIndex, slotIndex) {
  event.preventDefault();
  if (appState.isGenerating) return;
  const files = event.dataTransfer?.files;
  if (!files || !files.length) return;
  const [file] = files;
  if (!file) return;
  processDroppedFile(dayIndex, slotIndex, file);
}

async function processDroppedFile(dayIndex, slotIndex, file) {
  if (!file.type?.startsWith('image/')) {
    alert('Please drop an image file (PNG, JPG, or HEIC).');
    return;
  }
  const apiKey = appState.formData.apiKey?.trim();
  if (!apiKey) {
    alert('Add your OpenAI API key inside the Data Wizard before grading photos.');
    openUploader();
    return;
  }

  const key = getTileKey(dayIndex, slotIndex);
  if (getTileUploadState(key)) {
    return;
  }

  const currentMeal = ensureDashboardDay(dayIndex).meals?.[slotIndex];
  if (currentMeal?.pending) {
    return;
  }

  try {
    setTileUploadState(key, { phase: 'reading', message: 'Loading photo…' });
    renderDashboard();

    const { dataUrl, base64 } = await fileToBase64(file);
    const title = deriveMealTitle(dayIndex, slotIndex, file.name);

    const pendingMeal = {
      id: crypto.randomUUID(),
      title,
      source: { type: 'inline-image', dataUrl },
      breakdown: {
        vegFruit: 0,
        healthyCarbs: 0,
        protein: 0,
        pauseFood: 0,
        summary: 'Analyzing photo…'
      },
      generatedImageDataUrl: dataUrl,
      pending: true
    };
    setDashboardMeal(dayIndex, slotIndex, pendingMeal);
    renderDashboard();

    setTileUploadState(key, { phase: 'grading', message: 'Grading via OpenAI…' });
    renderDashboard();

    const breakdownRaw = await callMealBreakdown(apiKey, {
      title,
      source: {
        type: 'image',
        base64,
        mimeType: file.type || 'image/png'
      }
    });
    const normalized = normalizeBreakdown(breakdownRaw);
    const day = ensureDashboardDay(dayIndex);
    const meal = day.meals?.[slotIndex];
    if (!meal) {
      return;
    }
    meal.breakdown = normalized;
    meal.pending = false;
    meal.title = title;
    meal.source = { type: 'inline-image', dataUrl: meal.generatedImageDataUrl };
    meal.generatedImageDataUrl = meal.generatedImageDataUrl || dataUrl;
    delete meal.pending;
    recomputeDaySummary(dayIndex);
  } catch (error) {
    console.error('Photo grading failed', error);
    alert(`Unable to grade this photo: ${error.message}`);
    clearDashboardMeal(dayIndex, slotIndex);
  } finally {
    setTileUploadState(key, null);
    renderDashboard();
  }
}

function createActionButton({ text, variant = 'ghost', onClick, attrs = {} }) {
  const button = el('button', {
    className: `pill-button ${variant === 'primary' ? 'pill-button--primary' : ''}`,
    text,
    attrs
  });
  if (onClick) {
    button.addEventListener('click', onClick);
  }
  return button;
}

function createPrintLayoutButton() {
  const button = createActionButton({
    text: 'Print Layout',
    variant: 'primary'
  });
  button.addEventListener('click', () => {
    if (appState.viewMode === VIEW_MODES.print) {
      window.print();
      return;
    }
    enterPrintMode();
  });
  return button;
}

function createExportButton({ variant = 'ghost' } = {}) {
  const button = createActionButton({
    text: 'Export PDF',
    variant
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Rendering…';
    try {
      const data = appState.dashboardData ?? DEFAULT_DATA;
      const { blob, meta } = await renderDashboardPdf(data);
      openExportPreview({
        blob,
        filename: buildExportFilename(),
        meta
      });
    } catch (error) {
      console.error('Failed to export dashboard', error);
      alert('Unable to export the dashboard. Check console for details.');
    } finally {
      button.disabled = false;
      button.textContent = 'Export PDF';
    }
  });
  return button;
}

function createDownloadDataButton() {
  const button = createActionButton({
    text: 'Download JSON'
  });
  button.addEventListener('click', () => {
    const data = appState.dashboardData ?? DEFAULT_DATA;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `dashboard-data-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  return button;
}

function renderDashboard() {
  const data = appState.dashboardData ?? DEFAULT_DATA;
  const isPrintMode = appState.viewMode === VIEW_MODES.print;
  document.body.classList.toggle('print-mode', isPrintMode);
  updatePrintModeHint(isPrintMode);
  applyPalette(data.palette ?? DEFAULT_DATA.palette);
  const app = document.querySelector('#app');
  app.innerHTML = '';

  const [clientTitle, weekLabel] = formatTitle(data.clientName, data.weekLabel);
  const canvas = el('div', { className: 'dashboard-canvas' });
  const header = el('header', { className: 'dashboard-header' });

  const infoGroup = el('div', { className: 'dashboard-header__info' });
  const titleBlock = el('div', { className: 'dashboard-title' }, [
    el('span', { className: 'dashboard-title__client', text: clientTitle }),
    el('span', { className: 'dashboard-title__label', text: weekLabel })
  ]);

  const effectivePalette = {
    vegFruit:
      data.palette?.vegFruit ??
      getComputedStyle(document.documentElement).getPropertyValue('--veg-fruit')?.trim() ??
      DEFAULT_DATA.palette.vegFruit,
    healthyCarbs:
      data.palette?.healthyCarbs ??
      getComputedStyle(document.documentElement).getPropertyValue('--healthy-carbs')?.trim() ??
      DEFAULT_DATA.palette.healthyCarbs,
    protein:
      data.palette?.protein ??
      getComputedStyle(document.documentElement).getPropertyValue('--protein')?.trim() ??
      DEFAULT_DATA.palette.protein,
    pauseFood:
      data.palette?.pauseFood ??
      getComputedStyle(document.documentElement).getPropertyValue('--pause-food')?.trim() ??
      DEFAULT_DATA.palette.pauseFood
  };

  const legend = createLegend(effectivePalette);
  infoGroup.append(titleBlock, legend);

  if (!isPrintMode) {
    const actions = el('div', { className: 'dashboard-header__actions' });
    const uploaderButton = createActionButton({
      text: 'Open Data Wizard',
      onClick: () => openUploader()
    });
    actions.append(
      uploaderButton,
      createDownloadDataButton(),
      createPrintLayoutButton(),
      createExportButton()
    );
    header.append(infoGroup, actions);
  } else {
    header.appendChild(infoGroup);
  }
  canvas.appendChild(header);

  const grid = el('main', { className: 'dashboard-grid' });
  const dayCount = Math.max(data.days?.length ?? 0, 7);
  for (let i = 0; i < dayCount; i += 1) {
    const day = data.days?.[i] ?? { label: `Day ${i + 1}`, summary: {}, meals: [] };
    grid.appendChild(
      createDayColumn({
        day,
        dayIndex: i,
        isPrintMode,
        palette: {
          vegFruit: effectivePalette.vegFruit,
          healthyCarbs: effectivePalette.healthyCarbs,
          protein: effectivePalette.protein,
          pauseFood: effectivePalette.pauseFood
        }
      })
    );
  }
  canvas.appendChild(grid);
  app.appendChild(canvas);
}

function openUploader() {
  appState.isUploaderOpen = true;
  renderUploader();
}

function closeUploader() {
  if (appState.isGenerating) return;
  appState.isUploaderOpen = false;
  renderUploader();
}

function renderUploader() {
  uploaderOverlay.classList.toggle('is-open', appState.isUploaderOpen);
  if (!appState.isUploaderOpen) {
    uploaderOverlay.innerHTML = '';
    return;
  }

  uploaderOverlay.innerHTML = '';

  const panel = el('div', { className: 'uploader-panel' });
  const header = el('div', { className: 'uploader-header' });
  header.appendChild(el('h2', { className: 'uploader-title', text: 'Meal Intake Wizard' }));
  const closeButton = el('button', {
    className: 'uploader-close',
    html: '&times;',
    attrs: { type: 'button', 'aria-label': 'Close wizard' }
  });
  closeButton.disabled = appState.isGenerating;
  closeButton.addEventListener('click', closeUploader);
  header.appendChild(closeButton);
  panel.appendChild(header);

  const body = el('div', { className: 'uploader-body' });
  body.appendChild(renderApiKeyManager());
  body.appendChild(renderUploaderGeneralSection());
  body.appendChild(renderUploaderInstructions());
  body.appendChild(renderUploaderDays());

  panel.appendChild(body);
  panel.appendChild(renderUploaderFooter());
  uploaderOverlay.appendChild(panel);
}

function renderApiKeyManager() {
  const section = el('section', { className: 'uploader-section api-key-section' });
  section.appendChild(el('h3', { className: 'uploader-section__title', text: 'OpenAI API Key' }));
  section.appendChild(
    el('p', {
      className: 'uploader-note',
      text:
        'Save your API key once and this browser will reuse it for drag-and-drop grading and the wizard. Keys stay local to your device.'
    })
  );

  const row = el('div', { className: 'api-key-row' });
  const fieldWrapper = el('div', { className: 'api-key-field' });
  const input = document.createElement('input');
  input.type = appState.isApiKeyVisible ? 'text' : 'password';
  input.placeholder = 'sk-...';
  input.value = appState.apiKeyDraft ?? '';
  input.autocomplete = 'off';
  input.disabled = appState.isGenerating;
  input.addEventListener('input', (event) => {
    appState.apiKeyDraft = event.target.value;
  });
  fieldWrapper.appendChild(input);

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'api-key-toggle';
  toggleButton.textContent = appState.isApiKeyVisible ? 'Hide' : 'Show';
  toggleButton.addEventListener('click', () => {
    appState.isApiKeyVisible = !appState.isApiKeyVisible;
    renderUploader();
  });
  fieldWrapper.appendChild(toggleButton);
  row.appendChild(fieldWrapper);

  const actions = el('div', { className: 'api-key-actions' });
  const saveButton = createActionButton({
    text: appState.formData.apiKey ? 'Update key' : 'Save key',
    variant: 'primary',
    onClick: handleApiKeySave
  });
  saveButton.disabled = !appState.apiKeyDraft?.trim() || appState.isGenerating;
  actions.appendChild(saveButton);

  const clearButton = el('button', {
    className: 'tertiary-button',
    text: 'Clear saved key',
    attrs: { type: 'button' }
  });
  clearButton.disabled = !appState.formData.apiKey || appState.isGenerating;
  clearButton.addEventListener('click', handleApiKeyClear);
  actions.appendChild(clearButton);

  row.appendChild(actions);
  section.appendChild(row);

  const status = appState.apiKeyStatus?.message
    ? appState.apiKeyStatus
    : appState.formData.apiKey
      ? { type: 'success', message: 'API key saved locally.' }
      : { type: 'idle', message: 'No API key saved yet.' };

  section.appendChild(
    el('p', {
      className: `api-key-status api-key-status--${status.type}`,
      text: status.message
    })
  );

  return section;
}

function renderUploaderGeneralSection() {
  const section = el('section', { className: 'uploader-section' });
  section.appendChild(el('h3', { className: 'uploader-section__title', text: 'Account & Week Details' }));
  const grid = el('div', { className: 'uploader-grid' });

  grid.appendChild(
    renderInputField({
      label: 'Client Name',
      type: 'text',
      value: appState.formData.clientName,
      disabled: appState.isGenerating,
      onInput: (value) => {
        appState.formData.clientName = value;
      }
    })
  );

  grid.appendChild(
    renderInputField({
      label: 'Week Label',
      type: 'text',
      value: appState.formData.weekLabel,
      disabled: appState.isGenerating,
      onInput: (value) => {
        appState.formData.weekLabel = value;
      }
    })
  );

  grid.appendChild(
    renderInputField({
      label: 'Week Starting (optional)',
      type: 'date',
      value: appState.formData.startDate,
      disabled: appState.isGenerating,
      onInput: (value) => {
        appState.formData.startDate = value;
      }
    })
  );

  section.appendChild(grid);

  const toggles = el('div', { className: 'uploader-grid' });
  const checkboxField = el('div', { className: 'uploader-field' });
  const checkboxLabel = el('label', { text: 'Generate stylized meal pictures' });
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = appState.formData.generateImages;
  checkbox.disabled = appState.isGenerating;
  checkbox.addEventListener('change', (event) => {
    appState.formData.generateImages = Boolean(event.target.checked);
  });
  checkboxLabel.prepend(checkbox);
  checkboxField.appendChild(checkboxLabel);
  checkboxField.appendChild(
    el('p', {
      className: 'uploader-note',
      text: 'Uncheck if you want to keep your original photos instead of generating the standardized tile.'
    })
  );
  toggles.appendChild(checkboxField);
  section.appendChild(toggles);
  return section;
}

function renderUploaderInstructions() {
  const section = el('section', { className: 'uploader-section' });
  section.appendChild(el('h3', { className: 'uploader-section__title', text: 'Prompt Workflow' }));
  const note = el('p', {
    className: 'uploader-note',
    html:
      'Each meal runs through the provided <strong>Meal Breakdown</strong> prompt to capture percentages and narrative guidance. ' +
      'When “Generate stylized meal pictures” is enabled, the wizard also uses the <strong>Picture Generation</strong> prompt so every tile matches the reference look. ' +
      'Add photos or descriptions below and press “Build Dashboard Data” to populate the board automatically.'
  });
  section.appendChild(note);
  return section;
}

function renderUploaderDays() {
  const section = el('section', { className: 'uploader-section' });
  section.appendChild(el('h3', { className: 'uploader-section__title', text: 'Meals by Day' }));
  const daysContainer = el('div', { className: 'uploader-days' });

  appState.formData.days.forEach((day, index) => {
    const dayCard = el('div', { className: 'uploader-day', attrs: { 'data-day-id': day.id } });
    const header = el('div', { className: 'uploader-day__header' });
    const labelField = renderInputField({
      label: `Day ${index + 1} label`,
      type: 'text',
      value: day.label ?? '',
      disabled: appState.isGenerating,
      onInput: (value) => {
        day.label = value;
      }
    });
    header.appendChild(labelField);

    const dayActions = el('div', { className: 'uploader-day__actions' });

    if (appState.formData.days.length > 1) {
      const removeDayButton = el('button', {
        className: 'tertiary-button',
        text: 'Remove day',
        attrs: { type: 'button' }
      });
      removeDayButton.disabled = appState.isGenerating;
      removeDayButton.addEventListener('click', () => {
        removeDay(day.id);
      });
      dayActions.appendChild(removeDayButton);
    }

    const addMealButton = el('button', {
      className: 'tertiary-button',
      text: 'Add meal/snack',
      attrs: { type: 'button' }
    });
    addMealButton.disabled = appState.isGenerating;
    addMealButton.addEventListener('click', () => {
      addMeal(day.id);
    });
    dayActions.appendChild(addMealButton);

    header.appendChild(dayActions);
    dayCard.appendChild(header);

    const mealsContainer = el('div', { className: 'uploader-meals' });
    day.meals.forEach((meal) => {
      mealsContainer.appendChild(renderMealEditor(day, meal));
    });

    if (!day.meals.length) {
      mealsContainer.appendChild(
        el('p', {
          className: 'uploader-note',
          text: 'No meals yet. Add a meal or snack for this day to include it in the dashboard.'
        })
      );
    }

    dayCard.appendChild(mealsContainer);
    daysContainer.appendChild(dayCard);
  });

  const addDayButton = el('button', {
    className: 'tertiary-button',
    text: 'Add additional day',
    attrs: { type: 'button' }
  });
  addDayButton.disabled = appState.isGenerating;
  addDayButton.addEventListener('click', () => {
    addDay();
  });

  section.appendChild(daysContainer);
  section.appendChild(addDayButton);
  return section;
}

function renderMealEditor(day, meal) {
  const mealCard = el('article', {
    className: 'uploader-meal',
    attrs: { 'data-meal-id': meal.id }
  });

  const header = el('div', { className: 'uploader-meal__header' });
  header.appendChild(
    renderInputField({
      label: 'Meal title',
      type: 'text',
      value: meal.title,
      disabled: appState.isGenerating,
      onInput: (value) => {
        meal.title = value;
      }
    })
  );

  const typeField = el('div', { className: 'uploader-field' });
  const typeLabel = el('label', { text: 'Input type' });
  const select = document.createElement('select');
  select.disabled = appState.isGenerating;
  ['text', 'image'].forEach((type) => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type === 'text' ? 'Description' : 'Upload photo';
    option.selected = meal.type === type;
    select.appendChild(option);
  });
  select.addEventListener('change', (event) => {
    meal.type = event.target.value;
    if (meal.type === 'text') {
      meal.file = null;
      meal.fileDataUrl = '';
      meal.fileBase64 = '';
      meal.fileMimeType = '';
    } else {
      meal.text = '';
    }
    renderUploader();
  });
  typeField.appendChild(typeLabel);
  typeField.appendChild(select);
  header.appendChild(typeField);

  const removeButton = el('button', {
    className: 'tertiary-button',
    text: 'Remove meal',
    attrs: { type: 'button' }
  });
  removeButton.disabled = appState.isGenerating;
  removeButton.addEventListener('click', () => {
    removeMeal(day.id, meal.id);
  });
  header.appendChild(removeButton);
  mealCard.appendChild(header);

  if (meal.type === 'text') {
    mealCard.appendChild(
      renderTextAreaField({
        label: 'Meal description',
        placeholder: 'Describe everything on the plate…',
        value: meal.text,
        disabled: appState.isGenerating,
        onInput: (value) => {
          meal.text = value;
        }
      })
    );
  } else {
    const fileField = el('div', { className: 'uploader-field' });
    const fileLabel = el('label', { text: 'Meal photo' });
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.disabled = appState.isGenerating;
    input.addEventListener('change', async (event) => {
      const [file] = event.target.files;
      if (!file) return;
      const { dataUrl, base64 } = await fileToBase64(file);
      meal.file = file;
      meal.fileMimeType = file.type || 'image/png';
      meal.fileDataUrl = dataUrl;
      meal.fileBase64 = base64;
      renderUploader();
    });
    fileField.appendChild(fileLabel);
    fileField.appendChild(input);
    mealCard.appendChild(fileField);

    mealCard.appendChild(
      renderTextAreaField({
        label: 'Optional caption / context',
        placeholder: 'Anything important about how it was prepared or portioned…',
        value: meal.caption,
        disabled: appState.isGenerating,
        onInput: (value) => {
          meal.caption = value;
        }
      })
    );
  }

  if (meal.fileDataUrl || meal.generatedImageDataUrl) {
    const preview = el('div', { className: 'uploader-meal__preview' });
    preview.appendChild(
      el('img', {
        attrs: {
          src: meal.generatedImageDataUrl || meal.fileDataUrl,
          alt: meal.title || 'Meal preview'
        }
      })
    );
    mealCard.appendChild(preview);
  }

  if (meal.lastBreakdown) {
    mealCard.appendChild(
      el('p', {
        className: 'uploader-note',
        text: `Latest breakdown · Veg & Fruit ${meal.lastBreakdown.vegFruit}% · Healthy Carbs ${meal.lastBreakdown.healthyCarbs}% · Protein ${meal.lastBreakdown.protein}% · Pause Food ${meal.lastBreakdown.pauseFood}%`
      })
    );
  }

  return mealCard;
}

function renderInputField({ label, type, value, placeholder, disabled, onInput }) {
  const field = el('div', { className: 'uploader-field' });
  const labelElement = el('label', { text: label });
  const input = document.createElement('input');
  input.type = type;
  if (value !== undefined && value !== null) {
    input.value = value;
  }
  if (placeholder) input.placeholder = placeholder;
  input.disabled = disabled;
  input.addEventListener('input', (event) => {
    onInput?.(event.target.value);
  });
  field.append(labelElement, input);
  return field;
}

function renderTextAreaField({ label, value, placeholder, disabled, onInput }) {
  const field = el('div', { className: 'uploader-field' });
  const labelElement = el('label', { text: label });
  const textarea = document.createElement('textarea');
  textarea.value = value ?? '';
  if (placeholder) textarea.placeholder = placeholder;
  textarea.disabled = disabled;
  textarea.addEventListener('input', (event) => {
    onInput?.(event.target.value);
  });
  field.append(labelElement, textarea);
  return field;
}

function renderUploaderFooter() {
  const footer = el('footer', { className: 'uploader-footer' });
  const statusBlock = el('div', { className: 'uploader-status' });
  statusBlock.appendChild(
    el('span', {
      text: appState.generationStatus.message || 'Ready to build your dashboard.'
    })
  );
  const progress = el('div', { className: 'uploader-progress' });
  const fill = el('div', {
    className: 'uploader-progress__fill'
  });
  fill.style.setProperty('--progress', `${appState.generationStatus.progress * 100}%`);
  progress.appendChild(fill);
  statusBlock.appendChild(progress);
  footer.appendChild(statusBlock);

  const actions = el('div', { className: 'uploader-day__actions' });
  const cancelButton = createActionButton({
    text: 'Close',
    onClick: closeUploader
  });
  cancelButton.disabled = appState.isGenerating;
  actions.appendChild(cancelButton);

  const generateButton = createActionButton({
    text: appState.isGenerating ? 'Working…' : 'Build Dashboard Data',
    variant: 'primary',
    onClick: () => runGeneration()
  });
  generateButton.disabled = appState.isGenerating;
  actions.appendChild(generateButton);

  footer.appendChild(actions);
  return footer;
}

function addDay() {
  appState.formData.days.push({
    id: `day-${crypto.randomUUID()}`,
    label: `Day ${appState.formData.days.length + 1}`,
    meals: []
  });
  renderUploader();
}

function removeDay(dayId) {
  appState.formData.days = appState.formData.days.filter((day) => day.id !== dayId);
  if (!appState.formData.days.length) {
    appState.formData.days.push({
      id: `day-${crypto.randomUUID()}`,
      label: 'Day 1',
      meals: []
    });
  }
  renderUploader();
}

function addMeal(dayId) {
  const day = appState.formData.days.find((item) => item.id === dayId);
  if (!day) return;
  day.meals.push(createEmptyMeal());
  renderUploader();
}

function removeMeal(dayId, mealId) {
  const day = appState.formData.days.find((item) => item.id === dayId);
  if (!day) return;
  day.meals = day.meals.filter((meal) => meal.id !== mealId);
  renderUploader();
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = String(dataUrl).split(',')[1] ?? '';
      resolve({ dataUrl, base64 });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function setGenerationStatus(message, progress = 0) {
  appState.generationStatus = { message, progress };
  if (appState.isUploaderOpen) {
    const statusMessage = uploaderOverlay.querySelector('.uploader-status span');
    const progressFill = uploaderOverlay.querySelector('.uploader-progress__fill');
    if (statusMessage) statusMessage.textContent = message;
    if (progressFill) progressFill.style.setProperty('--progress', `${progress * 100}%`);
  }
}

function mealHasContent(meal) {
  if (meal.type === 'text') {
    return Boolean(meal.text?.trim());
  }
  return Boolean(meal.fileBase64);
}

function normalizeBreakdown(result) {
  const parsed = {
    vegFruit: Number(result.vegFruit ?? 0),
    healthyCarbs: Number(result.healthyCarbs ?? 0),
    protein: Number(result.protein ?? 0),
    pauseFood: Number(result.pauseFood ?? 0),
    summary: result.summary ?? '',
    adjustmentTips: result.adjustmentTips ?? ''
  };
  const total = parsed.vegFruit + parsed.healthyCarbs + parsed.protein + parsed.pauseFood;
  if (Math.abs(total - 100) > 0.5 && total > 0) {
    const scale = 100 / total;
    parsed.vegFruit = Math.round(parsed.vegFruit * scale * 10) / 10;
    parsed.healthyCarbs = Math.round(parsed.healthyCarbs * scale * 10) / 10;
    parsed.protein = Math.round(parsed.protein * scale * 10) / 10;
    parsed.pauseFood = Math.round(parsed.pauseFood * scale * 10) / 10;
  }
  return parsed;
}

function aggregateDay(meals) {
  if (!meals.length) {
    return {
      vegFruit: 0,
      healthyCarbs: 0,
      protein: 0,
      pauseFood: 0
    };
  }
  const totals = meals.reduce(
    (acc, meal) => {
      acc.vegFruit += meal.breakdown.vegFruit;
      acc.healthyCarbs += meal.breakdown.healthyCarbs;
      acc.protein += meal.breakdown.protein;
      acc.pauseFood += meal.breakdown.pauseFood;
      return acc;
    },
    { vegFruit: 0, healthyCarbs: 0, protein: 0, pauseFood: 0 }
  );
  return {
    vegFruit: Math.round((totals.vegFruit / meals.length) * 10) / 10,
    healthyCarbs: Math.round((totals.healthyCarbs / meals.length) * 10) / 10,
    protein: Math.round((totals.protein / meals.length) * 10) / 10,
    pauseFood: Math.round((totals.pauseFood / meals.length) * 10) / 10
  };
}

function buildUserContent({ title, source, additional }) {
  const segments = [];
  const descriptionLines = [];
  if (title) {
    descriptionLines.push(`Title: ${title}`);
  }

  if (source.type === 'text') {
    descriptionLines.push(`Kid meal description: ${source.value}`);
  } else {
    descriptionLines.push('Kid meal photo is attached.');
    if (source.caption) {
      descriptionLines.push(`Caption: ${source.caption}`);
    }
  }

  if (additional) {
    descriptionLines.push(additional);
  }

  segments.push({ type: 'input_text', text: descriptionLines.join('\n') });
  return segments;
}

function buildPicturePrompt({ meal, breakdown }) {
  const pauseShare = breakdown.pauseFood;
  const backgroundGuide =
    pauseShare < 10
      ? 'The background should be green because Pause foods are <10%.'
      : pauseShare <= 50
        ? 'Use a yellow/orange background because Pause foods are between 10% and 50%.'
        : 'Use a light red/pink background because Pause foods are over 50%.';

  const description =
    meal.source.type === 'text'
      ? meal.source.value
      : meal.source.caption ?? 'Use the attached meal photo as inspiration.';

  return `${PICTURE_GENERATION_PROMPT}

Meal title: ${meal.title ?? 'Meal'}
${backgroundGuide}
Include plate styling that references: Veg & Fruit ${breakdown.vegFruit}%, Healthy Carbs ${breakdown.healthyCarbs}%, Protein ${breakdown.protein}%, Pause Food ${breakdown.pauseFood}%.
Core meal notes: ${description}
`;
}

async function callMealBreakdown(apiKey, meal) {
  const imagePayload =
    meal.source.type === 'image'
      ? { data: meal.source.base64, mimeType: meal.source.mimeType }
      : null;

  const userContent = buildUserContent({
    title: meal.title,
    source: meal.source,
    additional: meal.source.type === 'image' ? meal.source.caption : undefined
  });

  if (imagePayload) {
    userContent.push({
      type: 'input_image',
      image_url: buildDataUrl(imagePayload.data, imagePayload.mimeType || 'image/png')
    });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: MEAL_BREAKDOWN_PROMPT }]
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: mealBreakdownSchema.name,
          schema: {
            ...mealBreakdownSchema.schema,
            required: Array.from(new Set([...(mealBreakdownSchema.schema.required ?? [])])),
            strict: true
          }
        }
      }
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error?.message ?? 'Meal breakdown failed');
  }
  const parsed = extractJsonSchemaOutput(result);
  if (!parsed) {
    throw new Error('Meal breakdown returned empty output.');
  }
  return parsed;
}

function extractImageFromResponse(result) {
  if (!result?.output) return null;
  for (const item of result.output) {
    if (!item?.content) continue;
    for (const content of item.content) {
      if (content.type === 'output_image') {
        const base64 =
          content.image?.base64 ?? content.image_base64 ?? content.image?.data ?? null;
        const mimeType = content.image?.mimeType ?? content.mime_type ?? 'image/png';
        if (base64) {
          return { base64, mimeType };
        }
      }
    }
  }
  return null;
}

async function callPictureGeneration(apiKey, meal, breakdown) {
  const prompt = buildPicturePrompt({ meal, breakdown });
  const imagePayload =
    meal.source.type === 'image'
      ? { data: meal.source.base64, mimeType: meal.source.mimeType }
      : null;

  const userContent = [
    {
      type: 'input_text',
      text: prompt
    }
  ];

  if (imagePayload) {
    userContent.push({
      type: 'input_image',
      image_url: buildDataUrl(imagePayload.data, imagePayload.mimeType || 'image/png')
    });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      modalities: ['text', 'image'],
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'You transform kids meals into stylized 4:5 ratio photos. Follow the brand guide and produce a single polished photo, no captions.'
            }
          ]
        },
        {
          role: 'user',
          content: userContent
        }
      ]
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error?.message ?? 'Meal image generation failed');
  }
  const image = extractImageFromResponse(result);
  if (!image) {
    throw new Error('No image content returned by the model.');
  }
  return image;
}

function buildGeneratedMeal(mealState) {
  return {
    id: mealState.id,
    title: mealState.title || 'Meal',
    source:
      mealState.type === 'text'
        ? { type: 'text', value: mealState.text }
        : mealState.fileDataUrl
          ? { type: 'inline-image', dataUrl: mealState.fileDataUrl }
          : { type: 'text', value: mealState.text },
    breakdown: mealState.lastBreakdown,
    generatedImageDataUrl: mealState.generatedImageDataUrl || mealState.fileDataUrl || ''
  };
}

async function runGeneration() {
  if (appState.isGenerating) return;
  if (!appState.formData.apiKey) {
    alert('Add your OpenAI API key before generating the dashboard.');
    return;
  }

  const filledMeals = [];
  appState.formData.days.forEach((day) => {
    day.meals.forEach((meal) => {
      if (mealHasContent(meal)) {
        filledMeals.push({ day, meal });
      }
    });
  });

  if (!filledMeals.length) {
    alert('Add at least one meal description or photo before generating the dashboard.');
    return;
  }

  appState.isGenerating = true;
  setGenerationStatus('Contacting OpenAI…', 0);
  renderUploader();

  try {
    const apiKey = appState.formData.apiKey.trim();
    let processed = 0;

    for (const { day, meal } of filledMeals) {
      setGenerationStatus(`Analyzing ${meal.title || 'meal'}…`, processed / filledMeals.length);
      const breakdownRaw = await callMealBreakdown(apiKey, {
        title: meal.title,
        source:
          meal.type === 'text'
            ? { type: 'text', value: meal.text }
            : {
                type: 'image',
                base64: meal.fileBase64,
                mimeType: meal.fileMimeType || 'image/png',
                caption: meal.caption
              }
      });
      meal.lastBreakdown = normalizeBreakdown(breakdownRaw);

      if (appState.formData.generateImages) {
        setGenerationStatus(
          `Generating tile for ${meal.title || 'meal'}…`,
          (processed + 0.5) / filledMeals.length
        );
        const generated = await callPictureGeneration(apiKey, {
          title: meal.title,
          source:
            meal.type === 'text'
              ? { type: 'text', value: meal.text }
              : {
                  type: 'image',
                  base64: meal.fileBase64,
                  mimeType: meal.fileMimeType || 'image/png',
                  caption: meal.caption
                }
        }, meal.lastBreakdown);
        meal.generatedImageDataUrl = `data:${generated.mimeType};base64,${generated.base64}`;
      } else if (meal.fileDataUrl) {
        meal.generatedImageDataUrl = meal.fileDataUrl;
      }

      processed += 1;
      setGenerationStatus(
        `Processed ${processed}/${filledMeals.length} meals.`,
        processed / filledMeals.length
      );
    }

    const generatedDays = appState.formData.days.map((day) => {
      const generatedMeals = day.meals
        .filter((meal) => mealHasContent(meal) && meal.lastBreakdown)
        .map((meal) => buildGeneratedMeal(meal));
      return {
        label: day.label || 'Day',
        meals: generatedMeals,
        summary: aggregateDay(generatedMeals)
      };
    });

    appState.dashboardData = {
      generatedAt: new Date().toISOString(),
      palette: structuredClone(DEFAULT_DATA.palette),
      clientName: appState.formData.clientName,
      weekLabel: appState.formData.weekLabel,
      startDate: appState.formData.startDate || null,
      days: generatedDays
    };

    setGenerationStatus('Dashboard updated. Scroll up to preview!', 1);
    renderDashboard();
  } catch (error) {
    console.error('Dashboard generation failed', error);
    alert(`Generation failed: ${error.message}`);
    setGenerationStatus('Generation failed. Check console for details.', 0);
  } finally {
    appState.isGenerating = false;
    renderUploader();
  }
}

async function init() {
  await loadDashboardData();
  restoreSavedApiKey();
  renderDashboard();
  renderUploader();
}

init();
