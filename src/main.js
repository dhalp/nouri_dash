import { toPng } from 'html-to-image';
import { MEAL_BREAKDOWN_PROMPT, PICTURE_GENERATION_PROMPT } from '../scripts/prompts.js';
import { renderCardSnapshotPdf } from './export/card-composer.js';
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

function createDefaultBreakdownSummary() {
  return {
    vegFruit: 0,
    healthyCarbs: 0,
    protein: 0,
    pauseFood: 0,
    summary: '',
    adjustmentTips: ''
  };
}

function createBreakdownPercentages(source = null) {
  const base = source ? structuredClone(source) : createDefaultBreakdownSummary();
  return {
    vegFruit: clampPercentage(base.vegFruit ?? 0),
    healthyCarbs: clampPercentage(base.healthyCarbs ?? 0),
    protein: clampPercentage(base.protein ?? 0),
    pauseFood: clampPercentage(base.pauseFood ?? 0)
  };
}

function clampPercentage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const clamped = Math.min(100, Math.max(0, numeric));
  return Math.round(clamped * 10) / 10;
}

function sumBreakdownPercentages(breakdown = {}) {
  return ['vegFruit', 'healthyCarbs', 'protein', 'pauseFood'].reduce(
    (total, key) => total + (Number(breakdown[key]) || 0),
    0
  );
}

function formatBreakdownTotalText(breakdown) {
  const total = Math.round(sumBreakdownPercentages(breakdown) * 10) / 10;
  return `Current total: ${total}% (goal 100%)`;
}

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

const PRINT_HINT_COPY = {
  idle: {
    title: 'Print layout ready.',
    body: 'Click to save this exact view as a 10" × 6.25" PDF card, or press Cmd+P/Ctrl+P to open the system print dialog.'
  },
  busy: {
    title: 'Exporting card…',
    body: 'Hold tight while we capture this layout at high resolution.'
  },
  success: {
    title: 'Card saved.',
    body: 'Check your downloads for the PDF. Click again if you need a refreshed capture.'
  },
  error: {
    title: 'Export failed.',
    body: 'Please try again after the page finishes loading or images resolve.'
  }
};

const PROMPT_STORAGE_KEY = 'emily-dashboard:prompt-overrides';

const PROMPT_METADATA = [
  {
    id: 'meal-breakdown',
    label: 'Meal Breakdown prompt',
    defaultValue: MEAL_BREAKDOWN_PROMPT,
    usage:
      'Sent as the system instruction when GPT-4.1 mini classifies a meal into Veg & Fruit, Healthy Carbs, Protein, and Pause Food inside callMealBreakdown.',
    dynamicContext: [
      'Title line built from the meal tile or uploaded filename (formatted as “Title: …”).',
      'Either the typed kid meal description or a notice that a meal photo is attached, plus any supplied caption.',
      'Response must satisfy `mealBreakdownSchema` with vegFruit, healthyCarbs, protein, pauseFood, summary, and adjustmentTips fields.'
    ]
  },
  {
    id: 'picture-generation',
    label: 'Picture Generation prompt',
    defaultValue: PICTURE_GENERATION_PROMPT,
    usage:
      'Prepended to the art direction we send as user content when GPT-4.1 mini generates stylized meal imagery inside callPictureGeneration.',
    dynamicContext: [
      'Meal title injected as “Meal title: …” using the tile name or fallback.',
      'Background guidance that switches to green, yellow/orange, or light red based on the Pause Food percentage.',
      'Macro breakdown appended as Veg & Fruit %, Healthy Carbs %, Protein %, and Pause Food % plus any typed or captioned notes.'
    ]
  }
];

const PROMPT_METADATA_BY_ID = PROMPT_METADATA.reduce((acc, entry) => {
  acc[entry.id] = entry;
  return acc;
}, {});

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
  viewMode: VIEW_MODES.interactive,
  isPrintCardExporting: false,
  tileEditorState: createInitialTileEditorState(),
  promptOverrides: {},
  promptEditorState: null
};

const uploaderOverlay = createUploaderOverlay();
const tileEditorOverlay = createTileEditorOverlay();
const promptEditorOverlay = createPromptEditorOverlay();
appState.promptEditorState = createInitialPromptEditorState();
let printModeHintTitleEl = null;
let printModeHintBodyEl = null;
let printModeHintResetTimer = null;
let currentPrintHintState = 'idle';
const printModeHint = createPrintModeHint();
let printModeForcedByBrowser = false;
setPrintModeHintState('idle');

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

function ensureFormDay(dayIndex) {
  if (!Array.isArray(appState.formData.days)) {
    appState.formData.days = createInitialFormState().days;
  }
  while (appState.formData.days.length <= dayIndex) {
    appState.formData.days.push({
      id: `day-${appState.formData.days.length + 1}`,
      label: `Day ${appState.formData.days.length + 1}`,
      meals: []
    });
  }
  return appState.formData.days[dayIndex];
}

function ensureFormMeal(dayIndex, slotIndex, type = 'text') {
  const day = ensureFormDay(dayIndex);
  while (day.meals.length <= slotIndex) {
    day.meals.push(createEmptyMeal(type));
  }
  if (!day.meals[slotIndex]) {
    day.meals[slotIndex] = createEmptyMeal(type);
  }
  return day.meals[slotIndex];
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

function syncFormMealToDashboard(dayIndex, slotIndex, { silent = false, allowCreate = false } = {}) {
  if (!appState.dashboardData || !Array.isArray(appState.formData.days)) return;
  const hasExistingDay = Array.isArray(appState.dashboardData.days) && appState.dashboardData.days[dayIndex];
  if (!allowCreate && !hasExistingDay) return;

  const formDay = appState.formData.days[dayIndex];
  const mealState = formDay?.meals?.[slotIndex];
  if (!mealState) return;

  if (!allowCreate) {
    const existingMeal = hasExistingDay && appState.dashboardData.days[dayIndex].meals?.[slotIndex];
    if (!existingMeal) return;
  }

  if (!mealState.lastBreakdown) {
    mealState.lastBreakdown = createDefaultBreakdownSummary();
  }

  const updatedMeal = buildGeneratedMeal(mealState);
  setDashboardMeal(dayIndex, slotIndex, updatedMeal);
  recomputeDaySummary(dayIndex);
  if (!silent) {
    renderDashboard();
  }
}

function clearDashboardMeal(dayIndex, slotIndex) {
  const day = ensureDashboardDay(dayIndex);
  if (slotIndex in day.meals) {
    delete day.meals[slotIndex];
    normalizeDayMeals(day);
  }
  recomputeDaySummary(dayIndex);
  syncFormDataFromDashboard();
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

function createInitialTileEditorState() {
  return {
    isOpen: false,
    dayIndex: null,
    slotIndex: null,
    title: '',
    description: '',
    mealId: null,
    breakdown: createBreakdownPercentages()
  };
}

function createPromptEditorDrafts() {
  return PROMPT_METADATA.reduce((acc, entry) => {
    acc[entry.id] = getActivePrompt(entry.id);
    return acc;
  }, {});
}

function createInitialPromptEditorState() {
  return {
    isOpen: false,
    drafts: createPromptEditorDrafts(),
    returnFocus: null,
    storageAvailable: Boolean(getLocalStorage()),
    errorMessage: ''
  };
}

function extractBase64FromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts.slice(1).join(',') : '';
}

function deriveMimeTypeFromDataUrl(dataUrl, fallback = 'image/png') {
  if (typeof dataUrl !== 'string') return fallback;
  const match = /^data:(.*?);/i.exec(dataUrl);
  return match ? match[1] : fallback;
}

function convertDashboardMealToFormMeal(meal) {
  const sourceType = meal?.source?.type === 'text' ? 'text' : 'image';
  const converted = createEmptyMeal(sourceType);
  converted.id = meal?.id || converted.id;
  converted.title = meal?.title || '';
  converted.caption = meal?.source?.caption || meal?.caption || '';
  converted.generatedImageDataUrl = meal?.generatedImageDataUrl || converted.generatedImageDataUrl;

  if (sourceType === 'text') {
    converted.text = meal?.source?.value || '';
  } else {
    const inlineDataUrl =
      meal?.generatedImageDataUrl ||
      (meal?.source?.type === 'inline-image' ? meal?.source?.dataUrl : '') ||
      '';
    if (meal?.source?.type === 'image' && meal?.source?.base64) {
      converted.fileBase64 = meal.source.base64;
      converted.fileMimeType = meal.source.mimeType || 'image/png';
      converted.fileDataUrl = buildDataUrl(converted.fileBase64, converted.fileMimeType);
    } else if (inlineDataUrl) {
      converted.fileDataUrl = inlineDataUrl;
      converted.fileBase64 = extractBase64FromDataUrl(inlineDataUrl);
      converted.fileMimeType = deriveMimeTypeFromDataUrl(inlineDataUrl);
    }
    converted.generatedImageDataUrl =
      converted.generatedImageDataUrl || converted.fileDataUrl || inlineDataUrl;
  }

  if (meal?.breakdown) {
    converted.lastBreakdown = structuredClone(meal.breakdown);
  }
  return converted;
}

function convertDashboardDayToFormDay(day, index) {
  const meals = Array.isArray(day?.meals)
    ? day.meals.filter(Boolean).map((meal) => convertDashboardMealToFormMeal(meal))
    : [];
  return {
    id: `day-${index + 1}`,
    label: day?.label ?? `Day ${index + 1}`,
    meals
  };
}

function syncFormDataFromDashboard({ shouldRender = true } = {}) {
  const data = appState.dashboardData ?? structuredClone(DEFAULT_DATA);
  appState.formData.clientName = data.clientName ?? DEFAULT_DATA.clientName;
  appState.formData.weekLabel = data.weekLabel ?? DEFAULT_DATA.weekLabel;
  appState.formData.startDate = data.startDate ?? appState.formData.startDate ?? '';

  const sourceDays =
    Array.isArray(data.days) && data.days.length ? data.days : DEFAULT_DATA.days;
  appState.formData.days = sourceDays.map((day, index) => convertDashboardDayToFormDay(day, index));

  if (!appState.formData.days.length) {
    appState.formData.days = createInitialFormState().days;
  }

  if (shouldRender && appState.isUploaderOpen) {
    renderUploader();
  }
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

function createTileEditorOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'tile-editor-overlay';
  overlay.className = 'tile-editor-overlay';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeTileEditor();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appState.tileEditorState.isOpen) {
      closeTileEditor();
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function createPromptEditorOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'prompt-editor-overlay';
  overlay.className = 'prompt-editor-overlay';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closePromptEditor();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appState.promptEditorState.isOpen) {
      closePromptEditor();
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function openPromptEditor(focusTarget = null) {
  if (appState.promptEditorState.isOpen) return;
  const activeElement = focusTarget || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  appState.promptEditorState = {
    ...createInitialPromptEditorState(),
    isOpen: true,
    drafts: createPromptEditorDrafts(),
    returnFocus: activeElement,
    storageAvailable: Boolean(getLocalStorage()),
    errorMessage: ''
  };
  renderPromptEditor();
  requestAnimationFrame(() => {
    const firstField = promptEditorOverlay.querySelector('.prompt-editor__textarea');
    if (firstField) {
      firstField.focus();
      const length = firstField.value.length;
      firstField.setSelectionRange(length, length);
    }
  });
}

function closePromptEditor() {
  const { returnFocus } = appState.promptEditorState;
  appState.promptEditorState = createInitialPromptEditorState();
  renderPromptEditor();
  if (returnFocus && typeof returnFocus.focus === 'function') {
    requestAnimationFrame(() => {
      returnFocus.focus();
    });
  }
}

function handlePromptEditorReset() {
  appState.promptOverrides = {};
  const result = persistPromptOverrides(appState.promptOverrides);
  if (result !== 'success') {
    alert('Browser storage is unavailable, so defaults will only last for this session.');
  }
  appState.promptEditorState.drafts = createPromptEditorDrafts();
  appState.promptEditorState.errorMessage = '';
  appState.promptEditorState.storageAvailable = result === 'success';
  renderPromptEditor();
  if (appState.isUploaderOpen) {
    renderUploader();
  }
}

function handlePromptEditorSave() {
  const drafts = appState.promptEditorState.drafts ?? {};
  const missing = PROMPT_METADATA.find((entry) => !drafts[entry.id] || !drafts[entry.id].trim());
  if (missing) {
    appState.promptEditorState.errorMessage = `${missing.label} must include text. Use Reset to defaults if you need the original copy.`;
    renderPromptEditor();
    return;
  }

  const overrides = {};
  PROMPT_METADATA.forEach((entry) => {
    const value = drafts[entry.id];
    if (typeof value === 'string' && value.length > 0 && value !== entry.defaultValue) {
      overrides[entry.id] = value;
    }
  });

  appState.promptOverrides = overrides;
  const result = persistPromptOverrides(overrides);
  if (result !== 'success') {
    alert('Browser storage is unavailable, so prompt changes will reset after you refresh. They will still apply for this session.');
  }
  closePromptEditor();
  if (appState.isUploaderOpen) {
    renderUploader();
  }
}

function renderPromptEditor() {
  const state = appState.promptEditorState;
  promptEditorOverlay.classList.toggle('is-open', state.isOpen);
  if (!state.isOpen) {
    promptEditorOverlay.innerHTML = '';
    return;
  }

  promptEditorOverlay.innerHTML = '';
  const modal = el('div', {
    className: 'prompt-editor',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'prompt-editor-title' }
  });

  const header = el('div', { className: 'prompt-editor__header' });
  header.appendChild(
    el('h2', {
      className: 'prompt-editor__title',
      text: 'Customize prompts',
      attrs: { id: 'prompt-editor-title' }
    })
  );
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'prompt-editor__close';
  closeButton.innerHTML = '&times;';
  closeButton.setAttribute('aria-label', 'Close prompt editor');
  closeButton.addEventListener('click', () => {
    closePromptEditor();
  });
  header.appendChild(closeButton);
  modal.appendChild(header);

  const body = el('div', { className: 'prompt-editor__body' });
  body.appendChild(
    el('p', {
      className: 'prompt-editor__intro',
      text:
        'These base prompts steer OpenAI when grading meals and creating stylized tiles. Edits apply immediately to new generations.'
    })
  );

  let errorMessageEl = null;

  PROMPT_METADATA.forEach((entry) => {
    const section = el('section', { className: 'prompt-editor__section' });
    section.appendChild(
      el('h3', {
        className: 'prompt-editor__section-title',
        text: entry.label
      })
    );
    section.appendChild(
      el('p', {
        className: 'prompt-editor__section-usage',
        text: entry.usage
      })
    );

    if (entry.dynamicContext?.length) {
      const list = el('ul', { className: 'prompt-editor__dynamic-list' });
      entry.dynamicContext.forEach((item) => {
        list.appendChild(el('li', { text: item }));
      });
      section.appendChild(list);
    }

    const field = el('label', { className: 'prompt-editor__field' });
    field.appendChild(
      el('span', {
        className: 'prompt-editor__field-label',
        text: 'Prompt text'
      })
    );
    const textarea = document.createElement('textarea');
    textarea.className = 'prompt-editor__textarea';
    textarea.rows = 12;
    textarea.value = state.drafts?.[entry.id] ?? getActivePrompt(entry.id);
    textarea.addEventListener('input', (event) => {
      appState.promptEditorState.drafts[entry.id] = event.target.value;
      if (appState.promptEditorState.errorMessage) {
        appState.promptEditorState.errorMessage = '';
        if (errorMessageEl) {
          errorMessageEl.textContent = '';
          errorMessageEl.setAttribute('hidden', 'true');
        }
      }
    });
    field.appendChild(textarea);
    section.appendChild(field);
    body.appendChild(section);
  });

  body.appendChild(
    el('p', {
      className: 'prompt-editor__note',
      text: state.storageAvailable
        ? 'Saved prompts live in this browser only. Share updates by exporting JSON or copying the text below.'
        : 'Browser storage is disabled, so prompts will reset after you refresh. Copy them elsewhere to keep a backup.'
    })
  );
  modal.appendChild(body);

  errorMessageEl = el('p', {
    className: 'prompt-editor__error',
    text: state.errorMessage ?? '',
    attrs: { role: 'alert' }
  });
  if (!state.errorMessage) {
    errorMessageEl.setAttribute('hidden', 'true');
  }
  modal.appendChild(errorMessageEl);

  const actions = el('div', { className: 'prompt-editor__actions' });
  const cancelButton = createActionButton({
    text: 'Cancel',
    onClick: () => closePromptEditor()
  });
  const resetButton = createActionButton({
    text: 'Reset to defaults',
    onClick: handlePromptEditorReset
  });
  const saveButton = createActionButton({
    text: 'Save changes',
    variant: 'primary',
    onClick: handlePromptEditorSave
  });
  actions.append(cancelButton, resetButton, saveButton);
  modal.appendChild(actions);

  promptEditorOverlay.appendChild(modal);
}

function createPrintModeHint() {
  if (typeof document === 'undefined') return null;
  const hint = document.createElement('div');
  hint.className = 'print-mode-hint';
  hint.setAttribute('role', 'button');
  hint.setAttribute('aria-hidden', 'true');
  hint.tabIndex = 0;

  const title = document.createElement('strong');
  title.className = 'print-mode-hint__title';
  const body = document.createElement('span');
  body.className = 'print-mode-hint__body';
  hint.append(title, body);
  printModeHintTitleEl = title;
  printModeHintBodyEl = body;
  title.textContent = PRINT_HINT_COPY.idle.title;
  body.textContent = PRINT_HINT_COPY.idle.body;

  hint.addEventListener('click', handlePrintHintActivation);
  hint.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handlePrintHintActivation();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appState.viewMode === VIEW_MODES.print) {
      event.preventDefault();
      exitPrintMode();
    }
  });
  if (typeof window !== 'undefined') {
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
  }
  document.body.appendChild(hint);
  return hint;
}

function updatePrintModeHint(isPrintMode) {
  if (!printModeHint) return;
  const visible = Boolean(isPrintMode);
  printModeHint.classList.toggle('is-visible', visible);
  printModeHint.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) {
    setPrintModeHintState('idle');
  }
}

function setPrintModeHintState(state) {
  if (!printModeHint) return;
  const nextState = PRINT_HINT_COPY[state] ? state : 'idle';
  const copy = PRINT_HINT_COPY[nextState];
  currentPrintHintState = nextState;
  if (printModeHintTitleEl) {
    printModeHintTitleEl.textContent = copy.title;
  }
  if (printModeHintBodyEl) {
    printModeHintBodyEl.textContent = copy.body;
  }
  printModeHint.classList.toggle('is-busy', nextState === 'busy');
  if (printModeHintResetTimer) {
    clearTimeout(printModeHintResetTimer);
    printModeHintResetTimer = null;
  }
  if (nextState === 'success' || nextState === 'error') {
    printModeHintResetTimer = setTimeout(() => {
      printModeHintResetTimer = null;
      if (appState.viewMode === VIEW_MODES.print) {
        setPrintModeHintState('idle');
      }
    }, 4500);
  }
}

function handlePrintHintActivation(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (appState.viewMode !== VIEW_MODES.print) return;
  if (appState.isPrintCardExporting || currentPrintHintState === 'busy') return;
  exportPrintLayoutCard();
}

async function exportPrintLayoutCard() {
  const canvas = document.querySelector('.dashboard-canvas');
  if (!canvas) {
    setPrintModeHintState('error');
    alert('Switch to Print Layout before exporting this card view.');
    return;
  }

  appState.isPrintCardExporting = true;
  setPrintModeHintState('busy');

  try {
    const imageDataUrl = await capturePrintLayoutImage(canvas);
    const { blob } = await renderCardSnapshotPdf(imageDataUrl);
    await triggerBlobDownload(blob, buildPrintCardFilename());
    setPrintModeHintState('success');
  } catch (error) {
    console.error('Print card export failed', error);
    setPrintModeHintState('error');
    alert(`Unable to export this view: ${error.message}`);
  } finally {
    appState.isPrintCardExporting = false;
  }
}

async function capturePrintLayoutImage(node) {
  const rect = node.getBoundingClientRect();
  const width = Math.max(Math.ceil(rect.width), node.scrollWidth || 0, node.offsetWidth || 0) || 1;
  const height = Math.max(Math.ceil(rect.height), node.scrollHeight || 0, node.offsetHeight || 0) || 1;
  const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const pixelRatio = Math.min(3, Math.max(1.5, deviceRatio * 1.25));
  return toPng(node, {
    cacheBust: true,
    pixelRatio,
    width,
    height,
    backgroundColor: '#ffffff',
    style: {
      transform: 'scale(1)',
      transformOrigin: 'top left'
    }
  });
}

function enterPrintMode({ silent = false } = {}) {
  if (appState.viewMode === VIEW_MODES.print) return;
  appState.viewMode = VIEW_MODES.print;
  setPrintModeHintState('idle');
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
  setPrintModeHintState('idle');
  renderDashboard();
}

function buildPrintCardFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `print-card-${timestamp}.pdf`;
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

function getPromptMetadata(id) {
  return PROMPT_METADATA_BY_ID[id] ?? null;
}

function getPromptDefaultValue(id) {
  return getPromptMetadata(id)?.defaultValue ?? '';
}

function getActivePrompt(id) {
  const override = appState.promptOverrides?.[id];
  if (typeof override === 'string' && override.length > 0) {
    return override;
  }
  return getPromptDefaultValue(id);
}

function restorePromptOverrides() {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(PROMPT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const normalized = {};
    PROMPT_METADATA.forEach((entry) => {
      const value = parsed[entry.id];
      if (typeof value === 'string' && value.length > 0 && value !== entry.defaultValue) {
        normalized[entry.id] = value;
      }
    });
    appState.promptOverrides = normalized;
  } catch (error) {
    console.warn('Unable to restore prompt overrides', error);
  }
}

function persistPromptOverrides(overrides) {
  const storage = getLocalStorage();
  if (!storage) return 'unavailable';
  try {
    if (overrides && Object.keys(overrides).length) {
      storage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(overrides));
    } else {
      storage.removeItem(PROMPT_STORAGE_KEY);
    }
    return 'success';
  } catch (error) {
    console.warn('Unable to persist prompt overrides', error);
    return 'error';
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
    syncFormDataFromDashboard({ shouldRender: false });
  } catch (error) {
    console.warn('Falling back to sample data. Run the generator or use the uploader to populate real data.', error);
    appState.dashboardData = structuredClone(DEFAULT_DATA);
    appState.tileUploads = {};
    syncFormDataFromDashboard({ shouldRender: false });
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
    card.addEventListener('click', () => {
      openTileEditor({ dayIndex, slotIndex });
    });
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
    card.addEventListener('click', () => {
      openTileEditor({ dayIndex, slotIndex });
    });
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
    syncFormDataFromDashboard();

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
    syncFormDataFromDashboard();
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
  const headerTop = el('div', { className: 'dashboard-header__top' });
  headerTop.append(titleBlock, legend);
  header.appendChild(headerTop);

  if (!isPrintMode) {
    const actions = el('div', { className: 'dashboard-header__actions' });
    const uploaderButton = createActionButton({
      text: 'Open Data Wizard',
      onClick: () => openUploader()
    });
    const promptButton = createActionButton({ text: 'Edit prompts' });
    promptButton.addEventListener('click', () => openPromptEditor(promptButton));
    actions.append(
      uploaderButton,
      promptButton,
      createDownloadDataButton(),
      createPrintLayoutButton()
    );
    header.appendChild(actions);
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

function openTileEditor({ dayIndex, slotIndex }) {
  if (appState.isGenerating) return;
  const formDay = ensureFormDay(dayIndex);
  const formMeal = formDay.meals?.[slotIndex] ?? null;
  const dashboardMeal = appState.dashboardData?.days?.[dayIndex]?.meals?.[slotIndex] ?? null;
  const titleFallback =
    formMeal?.title ||
    dashboardMeal?.title ||
    (dashboardMeal?.source?.path ? formatFilenameTitle(dashboardMeal.source.path) : '') ||
    `Day ${dayIndex + 1} meal ${slotIndex + 1}`;

  const summarySource =
    formMeal?.lastBreakdown?.summary ||
    dashboardMeal?.breakdown?.summary ||
    '';
  let description = summarySource || '';
  if (!description) {
    if (formMeal?.type === 'text') {
      description = formMeal.text ?? '';
    } else if (dashboardMeal?.source?.type === 'text') {
      description = dashboardMeal.source.value ?? '';
    } else if (formMeal?.caption) {
      description = formMeal.caption ?? '';
    }
  }

  const breakdownSource =
    formMeal?.lastBreakdown ||
    dashboardMeal?.breakdown ||
    createDefaultBreakdownSummary();

  appState.tileEditorState = {
    isOpen: true,
    dayIndex,
    slotIndex,
    mealId: formMeal?.id || dashboardMeal?.id || null,
    title: titleFallback,
    description,
    breakdown: createBreakdownPercentages(breakdownSource)
  };
  renderTileEditor();
}

function closeTileEditor() {
  if (!appState.tileEditorState.isOpen) return;
  appState.tileEditorState = createInitialTileEditorState();
  renderTileEditor();
}

function renderTileEditor() {
  tileEditorOverlay.classList.toggle('is-open', appState.tileEditorState.isOpen);
  if (!appState.tileEditorState.isOpen) {
    tileEditorOverlay.innerHTML = '';
    return;
  }

  const state = appState.tileEditorState;
  tileEditorOverlay.innerHTML = '';
  const dayLabel =
    appState.dashboardData?.days?.[state.dayIndex]?.label ||
    appState.formData?.days?.[state.dayIndex]?.label ||
    `Day ${state.dayIndex + 1}`;
  const modal = el('div', { className: 'tile-editor' });
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const header = el('div', { className: 'tile-editor__header' });
  header.appendChild(
    el('h3', {
      className: 'tile-editor__title',
      text: `${dayLabel} · Meal ${state.slotIndex + 1}`
    })
  );
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'tile-editor__close';
  closeButton.innerHTML = '&times;';
  closeButton.setAttribute('aria-label', 'Close editor');
  closeButton.addEventListener('click', closeTileEditor);
  header.appendChild(closeButton);
  modal.appendChild(header);

  const body = el('div', { className: 'tile-editor__body' });
  body.appendChild(buildTileEditorField({
    label: 'Meal title',
    inputType: 'input',
    value: state.title,
    placeholder: 'Give this plate a quick label…',
    onInput: (value) => {
      appState.tileEditorState.title = value;
    }
  }));

  body.appendChild(buildTileEditorField({
    label: 'Meal description',
    inputType: 'textarea',
    value: state.description,
    placeholder: 'Describe everything on the plate. This will feed the generator next time.',
    onInput: (value) => {
      appState.tileEditorState.description = value;
    }
  }));

  if (!state.breakdown) {
    appState.tileEditorState.breakdown = createBreakdownPercentages();
  }
  const totalIndicator = el('p', {
    className: 'tile-editor__total',
    text: formatBreakdownTotalText(appState.tileEditorState.breakdown)
  });
  const refreshTotalIndicator = () => {
    totalIndicator.textContent = formatBreakdownTotalText(appState.tileEditorState.breakdown);
    const roundedTotal = Math.round(sumBreakdownPercentages(appState.tileEditorState.breakdown));
    totalIndicator.classList.toggle('is-warning', roundedTotal !== 100);
  };
  refreshTotalIndicator();

  const breakdownGrid = buildTileEditorBreakdownGrid({
    breakdown: appState.tileEditorState.breakdown,
    onChange: (key, value) => {
      appState.tileEditorState.breakdown[key] = value;
      refreshTotalIndicator();
    }
  });

  const breakdownSection = el('div', { className: 'tile-editor__section tile-editor__section--breakdown' });
  breakdownSection.appendChild(
    el('span', { className: 'tile-editor__section-label', text: 'Meal breakdown (%)' })
  );
  breakdownSection.appendChild(breakdownGrid);
  breakdownSection.appendChild(totalIndicator);
  body.appendChild(breakdownSection);

  const hint = el('p', {
    className: 'tile-editor__hint',
    text: 'Saved notes sync into the Data Wizard and are used as text input for future generations.'
  });
  body.appendChild(hint);
  modal.appendChild(body);

  const actions = el('div', { className: 'tile-editor__actions' });
  const cancelButton = createActionButton({
    text: 'Cancel',
    onClick: closeTileEditor
  });
  const saveButton = createActionButton({
    text: 'Save description',
    variant: 'primary',
    onClick: handleTileEditorSave
  });
  actions.append(cancelButton, saveButton);
  modal.appendChild(actions);

  tileEditorOverlay.appendChild(modal);
  requestAnimationFrame(() => {
    const firstField = tileEditorOverlay.querySelector('.tile-editor__field input, .tile-editor__field textarea');
    firstField?.focus();
  });
}

function buildTileEditorField({ label, inputType, value, placeholder, onInput }) {
  const wrapper = el('label', { className: 'tile-editor__field' });
  const caption = el('span', { className: 'tile-editor__field-label', text: label });
  let control;
  if (inputType === 'textarea') {
    control = document.createElement('textarea');
    control.rows = 4;
  } else {
    control = document.createElement('input');
    control.type = 'text';
  }
  control.value = value ?? '';
  if (placeholder) control.placeholder = placeholder;
  control.addEventListener('input', (event) => {
    onInput?.(event.target.value);
  });
  wrapper.append(caption, control);
  return wrapper;
}

function buildBreakdownInputGrid({
  breakdown,
  onChange,
  disabled = false,
  gridClass = '',
  fieldClass = '',
  labelClass = ''
}) {
  const grid = el('div', { className: gridClass });
  CATEGORY_KEYS.forEach(({ key, label, emoji }) => {
    const field = el('label', { className: fieldClass });
    const caption = el('span', { className: labelClass, text: `${emoji} ${label}` });
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(breakdown?.[key] ?? 0);
    input.disabled = disabled;
    input.addEventListener('input', (event) => {
      const nextValue = clampPercentage(event.target.value);
      event.target.value = String(nextValue);
      onChange?.(key, nextValue);
    });
    field.append(caption, input);
    grid.appendChild(field);
  });
  return grid;
}

function buildTileEditorBreakdownGrid({ breakdown, onChange }) {
  return buildBreakdownInputGrid({
    breakdown,
    onChange,
    gridClass: 'tile-editor__breakdown-grid',
    fieldClass: 'tile-editor__field tile-editor__breakdown-field',
    labelClass: 'tile-editor__field-label'
  });
}

function handleTileEditorSave() {
  const state = appState.tileEditorState;
  if (state.dayIndex === null || state.slotIndex === null) {
    closeTileEditor();
    return;
  }
  const formDay = ensureFormDay(state.dayIndex);
  const meal = ensureFormMeal(state.dayIndex, state.slotIndex, 'text');
  const nextTitle = state.title?.trim() || meal.title || `Day ${state.dayIndex + 1} meal ${state.slotIndex + 1}`;
  meal.title = nextTitle;
  meal.type = 'text';
  const description = state.description?.trim() || '';
  meal.text = description;
  meal.caption = '';
  meal.file = null;
  meal.fileMimeType = '';
  meal.fileDataUrl = '';
  meal.fileBase64 = '';
  if (state.mealId) {
    meal.id = state.mealId;
  }
  if (!meal.lastBreakdown) {
    meal.lastBreakdown = createDefaultBreakdownSummary();
  }
  meal.lastBreakdown.summary = description;

  const editorBreakdown = state.breakdown || createBreakdownPercentages();
  CATEGORY_KEYS.forEach(({ key }) => {
    meal.lastBreakdown[key] = clampPercentage(editorBreakdown[key]);
  });

  formDay.meals[state.slotIndex] = meal;
  syncFormMealToDashboard(state.dayIndex, state.slotIndex, { allowCreate: true });
  if (appState.isUploaderOpen) {
    renderUploader();
  }
  closeTileEditor();
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
      'Use the <strong>Edit prompts</strong> button near the dashboard header to adjust the base instructions and review the dynamic lines the app adds (titles, captions, macro percentages). ' +
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
    day.meals.forEach((meal, mealIndex) => {
      mealsContainer.appendChild(renderMealEditor(day, meal, index, mealIndex));
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

function renderMealEditor(day, meal, dayIndex, mealIndex) {
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
        syncFormMealToDashboard(dayIndex, mealIndex, { silent: true });
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
    const breakdownEditor = el('div', { className: 'uploader-breakdown-editor' });
    const breakdownSummary = el('p', { className: 'uploader-note' });
    const totalIndicator = el('p', {
      className: 'uploader-breakdown-total',
      text: formatBreakdownTotalText(meal.lastBreakdown)
    });
    const formatSummary = () => {
      const getValue = (key) => clampPercentage(meal.lastBreakdown?.[key] ?? 0);
      return `Latest breakdown (edit below) · Veg & Fruit ${getValue('vegFruit')}% · Healthy Carbs ${getValue('healthyCarbs')}% · Protein ${getValue('protein')}% · Pause Food ${getValue('pauseFood')}%`;
    };
    const refreshBreakdownMeta = () => {
      breakdownSummary.textContent = formatSummary();
      totalIndicator.textContent = formatBreakdownTotalText(meal.lastBreakdown);
      const roundedTotal = Math.round(sumBreakdownPercentages(meal.lastBreakdown));
      totalIndicator.classList.toggle('is-warning', roundedTotal !== 100);
    };
    const breakdownGrid = buildBreakdownInputGrid({
      breakdown: meal.lastBreakdown,
      disabled: appState.isGenerating,
      gridClass: 'uploader-breakdown-grid',
      fieldClass: 'uploader-field uploader-breakdown-field',
      labelClass: 'uploader-breakdown-field__label',
      onChange: (key, value) => {
        meal.lastBreakdown[key] = value;
        refreshBreakdownMeta();
        syncFormMealToDashboard(dayIndex, mealIndex, { silent: true });
      }
    });
    refreshBreakdownMeta();
    breakdownEditor.appendChild(breakdownSummary);
    breakdownEditor.appendChild(breakdownGrid);
    breakdownEditor.appendChild(totalIndicator);

    breakdownEditor.appendChild(
      renderTextAreaField({
        label: 'Summary shown on the dashboard',
        placeholder: 'Edit the reasoning copy…',
        value: meal.lastBreakdown.summary,
        disabled: appState.isGenerating,
        onInput: (value) => {
          meal.lastBreakdown.summary = value;
          if (meal.type === 'text') {
            meal.text = value;
          }
          syncFormMealToDashboard(dayIndex, mealIndex, { silent: true });
        }
      })
    );

    breakdownEditor.appendChild(
      renderTextAreaField({
        label: 'Adjustment tip (optional)',
        placeholder: 'Add or tweak the action step…',
        value: meal.lastBreakdown.adjustmentTips,
        disabled: appState.isGenerating,
        onInput: (value) => {
          meal.lastBreakdown.adjustmentTips = value;
          syncFormMealToDashboard(dayIndex, mealIndex, { silent: true });
        }
      })
    );

    mealCard.appendChild(breakdownEditor);
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

  const basePrompt = getActivePrompt('picture-generation');

  return `${basePrompt}

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

  const mealBreakdownPrompt = getActivePrompt('meal-breakdown');

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
          content: [{ type: 'input_text', text: mealBreakdownPrompt }]
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
  const breakdown = mealState.lastBreakdown
    ? structuredClone(mealState.lastBreakdown)
    : createDefaultBreakdownSummary();
  return {
    id: mealState.id,
    title: mealState.title || 'Meal',
    source:
      mealState.type === 'text'
        ? { type: 'text', value: mealState.text }
        : mealState.fileDataUrl
          ? { type: 'inline-image', dataUrl: mealState.fileDataUrl }
          : { type: 'text', value: mealState.text },
    breakdown,
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
    syncFormDataFromDashboard();
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
  restorePromptOverrides();
  appState.promptEditorState.drafts = createPromptEditorDrafts();
  appState.promptEditorState.storageAvailable = Boolean(getLocalStorage());
  renderDashboard();
  renderUploader();
}

init();
