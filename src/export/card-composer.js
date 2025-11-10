import { PDFDocument } from 'pdf-lib';
import {
  CARD_EXPORT_HEIGHT_IN,
  CARD_EXPORT_PADDING_IN,
  CARD_EXPORT_WIDTH_IN,
  PDF_POINTS_PER_INCH,
  inchesToPoints
} from './pdf-constants.js';
import { dataUrlToUint8Array } from './pdf-utils.js';

function computeImagePlacement(image, pageWidth, pageHeight) {
  const padding = inchesToPoints(CARD_EXPORT_PADDING_IN);
  const maxWidth = pageWidth - padding * 2;
  const maxHeight = pageHeight - padding * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (pageWidth - width) / 2;
  const y = (pageHeight - height) / 2;
  return { x, y, width, height };
}

async function renderCardSnapshotPdf(dataUrl) {
  const payload = dataUrlToUint8Array(dataUrl);
  if (!payload?.bytes?.length) {
    throw new Error('Unable to capture this layout. Please try again after the page settles.');
  }

  const pdfDoc = await PDFDocument.create();
  const pageWidth = inchesToPoints(CARD_EXPORT_WIDTH_IN);
  const pageHeight = inchesToPoints(CARD_EXPORT_HEIGHT_IN);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const image = payload.mimeType === 'image/jpeg'
    ? await pdfDoc.embedJpg(payload.bytes)
    : await pdfDoc.embedPng(payload.bytes);
  const placement = computeImagePlacement(image, pageWidth, pageHeight);

  page.drawImage(image, placement);

  const pdfBytes = await pdfDoc.save();
  return {
    blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    meta: {
      widthIn: CARD_EXPORT_WIDTH_IN,
      heightIn: CARD_EXPORT_HEIGHT_IN,
      paddingIn: CARD_EXPORT_PADDING_IN,
      dpi: PDF_POINTS_PER_INCH
    }
  };
}

export { renderCardSnapshotPdf };
