/**
 * Placeholder: in the future this will turn a barcode string into renderable data
 * (e.g. Canvas pixels or an SVG). Currently it simply returns the input for display.
 * @param {string} barcodeString
 * @returns {string}
 */
export function encodeBarcodeStringToRenderableData(barcodeString) {
  // TODO: Implement real barcode generation (Code128/QR) and render to canvas or SVG.
  return barcodeString;
}

/**
 * Placeholder for future barcode detection from an uploaded image.
 * @param {File} file
 * @returns {Promise<never>}
 */
export function decodeBarcodeFromImage(file) {
  // TODO: Use a decoding library (e.g. ZXing) to read barcodes from images.
  return Promise.reject(new Error('Barcode decoding not implemented yet.'));
}
