import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  BODY_FONT_SIZE_PT,
  BRAND_CIRCLE_DIAMETER_IN,
  CARD_IMAGE_RATIO,
  CARD_MIN_HEIGHT_PT,
  CARD_TARGET_HEIGHT_PT,
  DAY_COLUMN_COUNT,
  DAY_COLUMN_GUTTER_IN,
  DAY_COLUMN_MEAL_SLOTS,
  DONUT_BLOCK_SPACING_PT,
  DONUT_RADIUS_IN,
  HEADER_BLOCK_HEIGHT_IN,
  HEADER_GAP_IN,
  HEADING_FONT_SIZE_PT,
  LABEL_BLOCK_SPACING_PT,
  LABEL_FONT_SIZE_PT,
  LEGEND_GAP_IN,
  LEGEND_WIDTH_IN,
  LETTER_HEIGHT_IN,
  LETTER_WIDTH_IN,
  MEAL_CARD_GAP_IN,
  PAGE_MARGIN_IN,
  PDF_POINTS_PER_INCH,
  SUBHEAD_FONT_SIZE_PT,
  TITLE_ACCENT_HEX,
  inchesToPoints
} from './pdf-constants.js';
import { dataUrlToUint8Array, normalizeDashboardForExport } from './pdf-utils.js';

const WHITE = rgb(1, 1, 1);
const TEXT_DARK = rgb(25 / 255, 25 / 255, 25 / 255);
const TEXT_MUTED = rgb(111 / 255, 111 / 255, 111 / 255);
const PLACEHOLDER_BG = rgb(247 / 255, 247 / 255, 247 / 255);
const PLACEHOLDER_STROKE = rgb(210 / 255, 210 / 255, 210 / 255);

async function renderDashboardPdf(rawData) {
  const model = normalizeDashboardForExport(rawData);
  const pdfDoc = await PDFDocument.create();
  const headingFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([inchesToPoints(LETTER_WIDTH_IN), inchesToPoints(LETTER_HEIGHT_IN)]);
  const margin = inchesToPoints(PAGE_MARGIN_IN);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const headerHeight = inchesToPoints(HEADER_BLOCK_HEIGHT_IN);
  const headerGap = inchesToPoints(HEADER_GAP_IN);
  const legendWidth = inchesToPoints(LEGEND_WIDTH_IN);
  const legendGap = inchesToPoints(LEGEND_GAP_IN);
  const bodyTopY = pageHeight - margin - headerHeight - headerGap;
  const bodyBottomY = margin;
  const bodyHeight = bodyTopY - bodyBottomY;
  const gutter = inchesToPoints(DAY_COLUMN_GUTTER_IN);
  const printableWidth = pageWidth - margin * 2;
  const totalGutter = gutter * (DAY_COLUMN_COUNT - 1);
  const columnWidth = (printableWidth - totalGutter) / DAY_COLUMN_COUNT;
  const legendX = pageWidth - margin - legendWidth;
  const legendSummary = computeOverallSummary(model.days);
  const layout = computeColumnLayout({
    bodyHeight,
    slots: DAY_COLUMN_MEAL_SLOTS,
    defaultDonutRadius: inchesToPoints(DONUT_RADIUS_IN),
    minDonutRadius: inchesToPoints(DONUT_RADIUS_IN * 0.65),
    labelBlockHeight: LABEL_FONT_SIZE_PT + LABEL_BLOCK_SPACING_PT,
    donutSpacing: DONUT_BLOCK_SPACING_PT,
    cardGap: inchesToPoints(MEAL_CARD_GAP_IN),
    targetCardHeight: CARD_TARGET_HEIGHT_PT,
    minCardHeight: CARD_MIN_HEIGHT_PT
  });

  const context = {
    pdfDoc,
    page,
    fonts: { heading: headingFont, body: bodyFont },
    model,
    palette: model.palette,
    margin,
    headerHeight,
    headerGap,
    legendWidth,
    legendX,
    legendGap,
    bodyTopY,
    bodyBottomY,
    columnWidth,
    gutter,
    layout,
    imageCache: new Map(),
    legendSummary
  };

  drawHeaderBlock(context);
  await drawDayColumns(context);

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const meta = {
    widthPt: pageWidth,
    heightPt: pageHeight,
    widthIn: pageWidth / PDF_POINTS_PER_INCH,
    heightIn: pageHeight / PDF_POINTS_PER_INCH,
    dpi: PDF_POINTS_PER_INCH,
    columnWidthPt: columnWidth,
    columnWidthIn: columnWidth / PDF_POINTS_PER_INCH,
    bodyHeightPt: layout.bodyHeight,
    cardHeightPt: layout.cardHeight,
    cardGapPt: layout.cardGap,
    labelBlockPt: layout.labelBlockHeight,
    donutBlockPt: layout.donutBlockHeight,
    donutRadiusPt: layout.donutRadius,
    mealSlots: DAY_COLUMN_MEAL_SLOTS
  };

  return {
    blob,
    meta
  };
}

function drawHeaderBlock(context) {
  const { page, fonts, model, margin, headerHeight, legendX, legendWidth, legendGap, palette } = context;
  const topY = page.getHeight() - margin;
  const titleSize = HEADING_FONT_SIZE_PT + 2;
  const subheadSize = SUBHEAD_FONT_SIZE_PT - 6;
  const accentColor = colorFromHex(TITLE_ACCENT_HEX);

  page.drawText(model.clientTitle, {
    x: margin,
    y: topY - titleSize,
    size: titleSize,
    font: fonts.heading,
    color: accentColor
  });

  page.drawText(model.weekLabel, {
    x: margin,
    y: topY - titleSize - subheadSize - 6,
    size: subheadSize,
    font: fonts.heading,
    color: TEXT_DARK
  });

  drawLegend(context, {
    x: legendX,
    y: topY,
    width: legendWidth,
    height: headerHeight - legendGap,
    accentColor: colorFromHex(palette.pauseFood)
  });
}

function drawLegend(context, bounds) {
  const { page, palette, model, fonts, legendSummary, layout } = context;
  const padding = 10;
  const donutRadius = Math.min(layout.donutRadius, bounds.width / 2.2);
  const donutCenterY = bounds.y - padding - donutRadius;
  const donutCenterX = bounds.x + donutRadius + padding;

  drawDonut(page, {
    cx: donutCenterX,
    cy: donutCenterY,
    radius: donutRadius,
    palette,
    summary: legendSummary
  });

  const brandSize = inchesToPoints(BRAND_CIRCLE_DIAMETER_IN);
  const brandX = bounds.x + bounds.width - brandSize - padding;
  const brandY = donutCenterY + donutRadius - brandSize / 2;
  page.drawCircle({
    x: brandX + brandSize / 2,
    y: brandY + brandSize / 2,
    size: brandSize / 2,
    color: colorFromHex(palette.pauseFood),
    borderColor: colorFromHex(palette.pauseFood)
  });
  page.drawText('n', {
    x: brandX + brandSize / 2 - 6,
    y: brandY + brandSize / 2 - 6,
    size: 14,
    font: fonts.heading,
    color: WHITE
  });

  const listX = donutCenterX + donutRadius + padding;
  const listY = donutCenterY + donutRadius - padding;
  const lineHeight = BODY_FONT_SIZE_PT + 2;
  model.categoryOrder.forEach((category, index) => {
    const y = listY - index * lineHeight;
    const color = colorFromHex(palette[category.key]);
    page.drawRectangle({
      x: listX,
      y: y - 5,
      width: 9,
      height: 9,
      color
    });
    page.drawText(category.label, {
      x: listX + 14,
      y: y - BODY_FONT_SIZE_PT,
      size: BODY_FONT_SIZE_PT,
      font: fonts.body,
      color: TEXT_DARK
    });
  });
}

async function drawDayColumns(context) {
  const { model } = context;
  for (let index = 0; index < DAY_COLUMN_COUNT; index += 1) {
    const day = model.days[index];
    if (!day) continue;
    await drawDayColumn(context, day, index);
  }
}

async function drawDayColumn(context, day, columnIndex) {
  const { page, fonts, palette, margin, bodyTopY, columnWidth, gutter, layout } = context;
  const columnX = margin + columnIndex * (columnWidth + gutter);
  let cursorY = bodyTopY;

  page.drawText(day.label.toUpperCase(), {
    x: columnX,
    y: cursorY - LABEL_FONT_SIZE_PT,
    size: LABEL_FONT_SIZE_PT,
    font: fonts.heading,
    color: TEXT_DARK
  });
  cursorY -= layout.labelBlockHeight;

  const donutRadius = Math.min(layout.donutRadius, columnWidth * 0.42);
  const donutCenterY = cursorY - donutRadius;
  const donutCenterX = columnX + donutRadius;
  drawDonut(page, {
    cx: donutCenterX,
    cy: donutCenterY,
    radius: donutRadius,
    palette,
    summary: day.summary
  });
  const donutSpacing = layout.donutSpacing ?? DONUT_BLOCK_SPACING_PT;
  cursorY -= donutRadius * 2 + donutSpacing;

  for (let slot = 0; slot < DAY_COLUMN_MEAL_SLOTS; slot += 1) {
    const meal = day.meals[slot];
    cursorY = await drawMealCard(context, {
      meal,
      x: columnX,
      width: columnWidth,
      topY: cursorY,
      cardHeight: layout.cardHeight
    });
    cursorY -= layout.cardGap;
  }
}

async function drawMealCard(context, { meal, x, width, topY, cardHeight }) {
  const { page, fonts, palette, layout } = context;
  const padding = 10;
  const cardY = topY - cardHeight;
  page.drawRectangle({
    x,
    y: cardY,
    width,
    height: cardHeight,
    color: WHITE,
    borderColor: colorFromHex(palette.neutral),
    borderWidth: 0.8
  });

  page.drawText(meal.title, {
    x: x + padding,
    y: topY - padding - BODY_FONT_SIZE_PT,
    size: BODY_FONT_SIZE_PT,
    font: fonts.heading,
    color: TEXT_DARK,
    maxWidth: width - padding * 2
  });

  const reservedBelowImage = 48;
  const maxImageHeight = Math.max(40, cardHeight - (BODY_FONT_SIZE_PT + padding * 2 + reservedBelowImage));
  const imageHeight = clamp(maxImageHeight, 40, cardHeight * CARD_IMAGE_RATIO);
  const imageY = topY - padding - BODY_FONT_SIZE_PT - 12 - imageHeight;
  const imageX = x + padding;
  await drawMealImage(context, {
    meal,
    x: imageX,
    y: imageY,
    width: width - padding * 2,
    height: imageHeight
  });

  const barY = imageY - 14;
  drawAllocationBar(context, {
    breakdown: meal.breakdown,
    x: x + padding,
    y: barY,
    width: width - padding * 2,
    height: 8
  });

  let textCursor = barY - 14;
  const summaryLines = wrapText(meal.summary || 'Awaiting notes…', fonts.body, LABEL_FONT_SIZE_PT, width - padding * 2, 3);
  textCursor = drawTextLines(page, summaryLines, {
    x: x + padding,
    startY: textCursor,
    font: fonts.body,
    size: LABEL_FONT_SIZE_PT,
    color: TEXT_MUTED
  });

  const tipsText = meal.adjustmentTips || (meal.hasData ? '' : 'Drop a meal photo or use the wizard to capture this slot.');
  if (tipsText) {
    const tipsLines = wrapText(tipsText, fonts.body, LABEL_FONT_SIZE_PT, width - padding * 2, 2);
    drawTextLines(page, tipsLines, {
      x: x + padding,
      startY: textCursor - 10,
      font: fonts.body,
      size: LABEL_FONT_SIZE_PT,
      color: TEXT_DARK
    });
  }

  return cardY;
}

async function drawMealImage(context, { meal, x, y, width, height }) {
  const { pdfDoc, page, palette, imageCache } = context;
  const imageData = meal.image;
  if (!imageData || !imageData.dataUrl) {
    drawImagePlaceholder(page, { x, y, width, height });
    return;
  }

  let embedded = imageCache.get(imageData.dataUrl);
  if (!embedded) {
    const decoded = dataUrlToUint8Array(imageData.dataUrl);
    if (!decoded) {
      drawImagePlaceholder(page, { x, y, width, height });
      return;
    }
    const mime = decoded.mimeType || 'image/png';
    embedded = mime.includes('png')
      ? await pdfDoc.embedPng(decoded.bytes)
      : await pdfDoc.embedJpg(decoded.bytes);
    imageCache.set(imageData.dataUrl, embedded);
  }
  const scale = Math.min(width / embedded.width, height / embedded.height);
  const drawWidth = embedded.width * scale;
  const drawHeight = embedded.height * scale;
  page.drawImage(embedded, {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight
  });
}

function drawImagePlaceholder(page, { x, y, width, height }) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: PLACEHOLDER_BG,
    borderColor: PLACEHOLDER_STROKE,
    borderWidth: 0.75
  });
  page.drawLine({
    start: { x: x + 6, y: y + 6 },
    end: { x: x + width - 6, y: y + height - 6 },
    color: PLACEHOLDER_STROKE,
    thickness: 0.5
  });
  page.drawLine({
    start: { x: x + width - 6, y: y + 6 },
    end: { x: x + 6, y: y + height - 6 },
    color: PLACEHOLDER_STROKE,
    thickness: 0.5
  });
}

function drawAllocationBar(context, { breakdown, x, y, width, height }) {
  const { page, palette, model } = context;
  const outlineColor = colorFromHex(palette.neutral);
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.93, 0.93, 0.93)
  });
  let cursor = x;
  model.categoryOrder.forEach((category) => {
    const value = Math.max(0, Math.min(100, breakdown?.[category.key] ?? 0));
    if (!value) {
      return;
    }
    const sliceWidth = (value / 100) * width;
    page.drawRectangle({
      x: cursor,
      y,
      width: sliceWidth,
      height,
      color: colorFromHex(palette[category.key])
    });
    cursor += sliceWidth;
  });
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderWidth: 0.5,
    borderColor: outlineColor
  });
}

function drawDonut(page, { cx, cy, radius, palette, summary }) {
  const innerRadius = radius * 0.55;
  let currentAngle = -90;
  const order = ['vegFruit', 'protein', 'healthyCarbs', 'pauseFood'];
  order.forEach((key) => {
    const value = Math.max(0, summary?.[key] ?? 0);
    const sweep = (value / 100) * 360;
    if (sweep <= 0) {
      return;
    }
    const path = buildDonutWedgePath(cx, cy, radius, innerRadius, currentAngle, currentAngle + sweep);
    page.drawSvgPath(path, {
      color: colorFromHex(palette[key] || '#cccccc'),
      borderColor: colorFromHex(palette[key] || '#cccccc'),
      borderWidth: 0
    });
    currentAngle += sweep;
  });

  page.drawCircle({
    x: cx,
    y: cy,
    size: innerRadius,
    color: WHITE,
    borderColor: WHITE
  });
}

function buildDonutWedgePath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, endAngle);
  const endInner = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    'Z'
  ].join(' ');
}

function polarToCartesian(cx, cy, radius, angleDegrees) {
  const angleRadians = ((angleDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians)
  };
}

function hexToRgb(hex) {
  if (!hex) {
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function colorFromHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
}

function computeOverallSummary(days = []) {
  const totals = { vegFruit: 0, healthyCarbs: 0, protein: 0, pauseFood: 0 };
  let count = 0;
  days.forEach((day) => {
    if (!day?.summary) return;
    totals.vegFruit += day.summary.vegFruit ?? 0;
    totals.healthyCarbs += day.summary.healthyCarbs ?? 0;
    totals.protein += day.summary.protein ?? 0;
    totals.pauseFood += day.summary.pauseFood ?? 0;
    count += 1;
  });
  if (!count) {
    return { vegFruit: 25, healthyCarbs: 25, protein: 25, pauseFood: 25 };
  }
  return {
    vegFruit: totals.vegFruit / count,
    healthyCarbs: totals.healthyCarbs / count,
    protein: totals.protein / count,
    pauseFood: totals.pauseFood / count
  };
}

function computeColumnLayout({
  bodyHeight,
  slots,
  defaultDonutRadius,
  minDonutRadius,
  labelBlockHeight,
  donutSpacing,
  cardGap,
  targetCardHeight,
  minCardHeight
}) {
  const donutRadius = clamp(bodyHeight * 0.12, minDonutRadius, defaultDonutRadius);
  const donutBlockHeight = donutRadius * 2 + donutSpacing;
  const availableForCards = Math.max(bodyHeight - labelBlockHeight - donutBlockHeight, 0);
  const maxCardHeight = availableForCards > 0 ? (availableForCards - cardGap * (slots - 1)) / slots : minCardHeight;
  const cardHeight = clamp(targetCardHeight, Math.min(minCardHeight, maxCardHeight), maxCardHeight);

  return {
    donutRadius,
    donutBlockHeight,
    donutSpacing,
    labelBlockHeight,
    cardHeight,
    cardGap,
    bodyHeight,
    mealSlots: slots
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(max)) return min;
  return Math.min(Math.max(value, min), max);
}

function wrapText(text, font, size, maxWidth, maxLines = Infinity) {
  if (!text) return [];
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    const last = trimmed[trimmed.length - 1];
    trimmed[trimmed.length - 1] = `${last.replace(/\.*$/, '')}…`;
    return trimmed;
  }
  return lines;
}

function drawTextLines(page, lines, { x, startY, font, size, color, lineHeight = size + 2 }) {
  let cursor = startY;
  lines.forEach((line) => {
    page.drawText(line, {
      x,
      y: cursor - size,
      size,
      font,
      color
    });
    cursor -= lineHeight;
  });
  return cursor;
}

export { renderDashboardPdf };
