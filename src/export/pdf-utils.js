import {
  CATEGORY_ORDER,
  DAY_COLUMN_COUNT,
  DAY_COLUMN_MEAL_SLOTS,
  DEFAULT_PALETTE
} from './pdf-constants.js';

const DEFAULT_CLIENT_NAME = 'Maria';
const DEFAULT_WEEK_LABEL = 'tracked meals';

function clamp(value, min = 0, max = 100) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function createEmptyBreakdown() {
  return {
    vegFruit: 0,
    healthyCarbs: 0,
    protein: 0,
    pauseFood: 0
  };
}

function normalizePalette(rawPalette = {}) {
  return {
    vegFruit: rawPalette.vegFruit || DEFAULT_PALETTE.vegFruit,
    healthyCarbs: rawPalette.healthyCarbs || DEFAULT_PALETTE.healthyCarbs,
    protein: rawPalette.protein || DEFAULT_PALETTE.protein,
    pauseFood: rawPalette.pauseFood || DEFAULT_PALETTE.pauseFood,
    neutral: rawPalette.neutral || DEFAULT_PALETTE.neutral,
    canvasBg: rawPalette.canvasBg || DEFAULT_PALETTE.canvasBg
  };
}

function sanitizeName(value, fallback) {
  const trimmed = (value ?? '').trim();
  return trimmed || fallback;
}

function formatClientHeading(clientName, weekLabel) {
  const sanitizedName = sanitizeName(clientName, DEFAULT_CLIENT_NAME);
  const week = sanitizeName(weekLabel, DEFAULT_WEEK_LABEL);
  const needsApostrophe = /s$/i.test(sanitizedName);
  const possessive = `${sanitizedName}${needsApostrophe ? "'" : "'s"}`;
  return {
    clientName: sanitizedName,
    clientTitle: possessive,
    weekLabel: week,
    titleLine: `${possessive} ${week}`
  };
}

function normalizeBreakdown(raw = {}) {
  const base = createEmptyBreakdown();
  const parsed = {
    vegFruit: clamp(Number(raw.vegFruit ?? base.vegFruit)),
    healthyCarbs: clamp(Number(raw.healthyCarbs ?? base.healthyCarbs)),
    protein: clamp(Number(raw.protein ?? base.protein)),
    pauseFood: clamp(Number(raw.pauseFood ?? base.pauseFood))
  };
  const total = parsed.vegFruit + parsed.healthyCarbs + parsed.protein + parsed.pauseFood;
  if (total > 0 && Math.abs(total - 100) > 0.5) {
    const scale = 100 / total;
    parsed.vegFruit = Math.round(parsed.vegFruit * scale * 10) / 10;
    parsed.healthyCarbs = Math.round(parsed.healthyCarbs * scale * 10) / 10;
    parsed.protein = Math.round(parsed.protein * scale * 10) / 10;
    parsed.pauseFood = Math.round(parsed.pauseFood * scale * 10) / 10;
  }
  return parsed;
}

function normalizeMealsForDay(rawMeals = [], { dayIndex }) {
  const existing = Array.isArray(rawMeals) ? rawMeals.filter(Boolean) : [];
  const normalized = existing.slice(0, DAY_COLUMN_MEAL_SLOTS).map((meal, slotIndex) => ({
    id: meal.id || `day-${dayIndex + 1}-meal-${slotIndex + 1}`,
    title: sanitizeName(meal.title, `Meal ${slotIndex + 1}`),
    breakdown: normalizeBreakdown(meal.breakdown),
    summary: meal.breakdown?.summary || '',
    adjustmentTips: meal.breakdown?.adjustmentTips || '',
    image: deriveMealImage(meal),
    hasData: Boolean(meal.breakdown),
    source: meal.source || null
  }));

  while (normalized.length < DAY_COLUMN_MEAL_SLOTS) {
    const slotIndex = normalized.length;
    normalized.push({
      id: `day-${dayIndex + 1}-placeholder-${slotIndex + 1}`,
      title: `Meal ${slotIndex + 1}`,
      breakdown: createEmptyBreakdown(),
      summary: '',
      adjustmentTips: '',
      image: null,
      hasData: false,
      source: null
    });
  }

  return normalized;
}

function aggregateDayPercentages(meals) {
  const eligible = meals
    .filter((meal) => meal && meal.hasData && meal.breakdown)
    .map((meal) => meal.breakdown);
  if (!eligible.length) {
    return createEmptyBreakdown();
  }
  const totals = eligible.reduce(
    (acc, breakdown) => {
      acc.vegFruit += breakdown.vegFruit;
      acc.healthyCarbs += breakdown.healthyCarbs;
      acc.protein += breakdown.protein;
      acc.pauseFood += breakdown.pauseFood;
      return acc;
    },
    createEmptyBreakdown()
  );
  return {
    vegFruit: Math.round((totals.vegFruit / eligible.length) * 10) / 10,
    healthyCarbs: Math.round((totals.healthyCarbs / eligible.length) * 10) / 10,
    protein: Math.round((totals.protein / eligible.length) * 10) / 10,
    pauseFood: Math.round((totals.pauseFood / eligible.length) * 10) / 10
  };
}

function normalizeDashboardForExport(rawData = {}) {
  const palette = normalizePalette(rawData.palette);
  const heading = formatClientHeading(rawData.clientName, rawData.weekLabel);
  const days = Array.from({ length: DAY_COLUMN_COUNT }, (_, index) => {
    const source = rawData.days?.[index] || null;
    const label = sanitizeName(source?.label, `Day ${index + 1}`);
    const meals = normalizeMealsForDay(source?.meals || [], { dayIndex: index });
    const summary = aggregateDayPercentages(meals);
    return {
      label,
      summary,
      meals
    };
  });

  return {
    ...heading,
    palette,
    days,
    categoryOrder: CATEGORY_ORDER
  };
}

function deriveMealImage(meal) {
  if (!meal) return null;
  if (meal.generatedImageDataUrl) {
    return normalizeImageData(meal.generatedImageDataUrl);
  }
  const source = meal.source;
  if (!source) return null;

  if (source.dataUrl) {
    return normalizeImageData(source.dataUrl);
  }

  if (source.type === 'inline-image' && source.value) {
    return normalizeImageData(source.value);
  }

  if (source.type === 'image' && source.base64) {
    const mimeType = source.mimeType || 'image/png';
    return normalizeImageData(`data:${mimeType};base64,${source.base64}`);
  }

  if (typeof source === 'string' && source.startsWith('data:')) {
    return normalizeImageData(source);
  }

  return null;
}

function normalizeImageData(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }
  return {
    dataUrl,
    mimeType: extractMimeType(dataUrl)
  };
}

function extractMimeType(dataUrl) {
  const match = /^data:(.*?);/i.exec(dataUrl || '');
  return match ? match[1] : 'application/octet-stream';
}

function dataUrlToUint8Array(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return null;
  const meta = parts[0];
  const base64 = parts.slice(1).join(',');
  if (!/;base64/i.test(meta)) return null;
  const cleaned = base64.trim();
  const bytes = base64ToUint8Array(cleaned);
  const mimeType = extractMimeType(meta);
  return {
    bytes,
    mimeType
  };
}

function base64ToUint8Array(base64) {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  throw new Error('Base64 decoding is not supported in this environment.');
}

export {
  aggregateDayPercentages,
  dataUrlToUint8Array,
  deriveMealImage,
  formatClientHeading,
  normalizeDashboardForExport,
  normalizePalette
};
