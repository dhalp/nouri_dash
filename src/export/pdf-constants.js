const PDF_POINTS_PER_INCH = 72;
const LETTER_WIDTH_IN = 11;
const LETTER_HEIGHT_IN = 8.5;
const PAGE_MARGIN_IN = 0.35;
const HEADER_BLOCK_HEIGHT_IN = 1.45;
const HEADER_GAP_IN = 0.2;
const LEGEND_WIDTH_IN = 3.6;
const LEGEND_GAP_IN = 0.3;
const DAY_COLUMN_COUNT = 7;
const DAY_COLUMN_GUTTER_IN = 0.1;
const DAY_COLUMN_MEAL_SLOTS = 3;
const MEAL_CARD_GAP_IN = 0.08;
const DONUT_RADIUS_IN = 0.42;
const DONUT_STROKE_PT = 10;
const BRAND_CIRCLE_DIAMETER_IN = 0.75;
const HEADING_FONT_SIZE_PT = 32;
const SUBHEAD_FONT_SIZE_PT = 24;
const BODY_FONT_SIZE_PT = 11.5;
const LABEL_FONT_SIZE_PT = 9;
const LABEL_BLOCK_SPACING_PT = 12;
const DONUT_BLOCK_SPACING_PT = 10;
const CARD_TARGET_HEIGHT_PT = 138;
const CARD_MIN_HEIGHT_PT = 104;
const CARD_IMAGE_RATIO = 0.46;
const TITLE_ACCENT_HEX = '#f48a1f';

const CATEGORY_ORDER = [
  { key: 'vegFruit', label: 'Always Food', emoji: '🥦' },
  { key: 'protein', label: 'Fuel Food · Protein', emoji: '🍗' },
  { key: 'healthyCarbs', label: 'Fuel Food · Whole Grain', emoji: '🍞' },
  { key: 'pauseFood', label: 'Pause Food', emoji: '⏸️' }
];

const DEFAULT_PALETTE = {
  vegFruit: '#4fa742',
  healthyCarbs: '#f5d957',
  protein: '#f59f1a',
  pauseFood: '#f2899a',
  neutral: '#d2d2d2',
  canvasBg: '#ffffff'
};

function inchesToPoints(value = 0) {
  return value * PDF_POINTS_PER_INCH;
}

function pointsToInches(value = 0) {
  return value / PDF_POINTS_PER_INCH;
}

function printableWidthIn() {
  return LETTER_WIDTH_IN - PAGE_MARGIN_IN * 2;
}

function printableHeightIn() {
  return LETTER_HEIGHT_IN - PAGE_MARGIN_IN * 2;
}

export {
  PDF_POINTS_PER_INCH,
  LETTER_WIDTH_IN,
  LETTER_HEIGHT_IN,
  PAGE_MARGIN_IN,
  HEADER_BLOCK_HEIGHT_IN,
  HEADER_GAP_IN,
  LEGEND_WIDTH_IN,
  LEGEND_GAP_IN,
  DAY_COLUMN_COUNT,
  DAY_COLUMN_GUTTER_IN,
  DAY_COLUMN_MEAL_SLOTS,
  MEAL_CARD_GAP_IN,
  DONUT_RADIUS_IN,
  DONUT_STROKE_PT,
  BRAND_CIRCLE_DIAMETER_IN,
  HEADING_FONT_SIZE_PT,
  SUBHEAD_FONT_SIZE_PT,
  BODY_FONT_SIZE_PT,
  LABEL_FONT_SIZE_PT,
  LABEL_BLOCK_SPACING_PT,
  DONUT_BLOCK_SPACING_PT,
  CARD_TARGET_HEIGHT_PT,
  CARD_MIN_HEIGHT_PT,
  CARD_IMAGE_RATIO,
  TITLE_ACCENT_HEX,
  CATEGORY_ORDER,
  DEFAULT_PALETTE,
  inchesToPoints,
  pointsToInches,
  printableWidthIn,
  printableHeightIn
};
