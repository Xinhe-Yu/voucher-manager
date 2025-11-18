const QUAGGA_SRC = 'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js';
const JSBARCODE_SRC = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';

let quaggaReady;
let jsBarcodeReady;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureQuagga() {
  if (!quaggaReady) {
    quaggaReady = loadScript(QUAGGA_SRC).then(() => {
      if (!window.Quagga) throw new Error('Quagga failed to load');
      return window.Quagga;
    });
  }
  return quaggaReady;
}

async function ensureJsBarcode() {
  if (!jsBarcodeReady) {
    jsBarcodeReady = loadScript(JSBARCODE_SRC).then(() => {
      if (!window.JsBarcode) throw new Error('JsBarcode failed to load');
      return window.JsBarcode;
    });
  }
  return jsBarcodeReady;
}

/**
 * Render a barcode string to a canvas or SVG element using JsBarcode.
 * Falls back to text-only when rendering fails.
 * @param {HTMLElement} element Canvas or SVG element
 * @param {string} value
 * @param {{format?: string, width?: number, height?: number, displayValue?: boolean}} [options]
 */
export async function renderBarcode(element, value, options = {}) {
  const JsBarcode = await ensureJsBarcode();
  const defaults = { format: 'CODE128', height: 60, width: 2, displayValue: true };
  try {
    JsBarcode(element, value, { ...defaults, ...options });
  } catch (err) {
    console.error('JsBarcode failed, falling back to text render.', err);
    const ctx = element.getContext?.('2d');
    if (ctx) {
      ctx.clearRect(0, 0, element.width, element.height);
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#111';
      ctx.fillText(value, 8, element.height / 2);
    } else {
      element.textContent = value;
    }
  }
}

/**
 * Decode a still image file using Quagga's single image mode.
 * @param {File} file
 * @param {{readers?: string[]}} [options]
 * @returns {Promise<{code: string, format?: string}|null>} resolved with the detected code/format or null
 */
export async function decodeBarcodeFromImage(file, { readers = ['code_128_reader', 'ean_reader', 'ean_8_reader', 'code_39_reader'] } = {}) {
  if (!file) throw new Error('No file provided');
  const Quagga = await ensureQuagga();
  const dataUrl = await readFileAsDataURL(file);

  return new Promise((resolve) => {
    Quagga.decodeSingle(
      {
        src: dataUrl,
        numOfWorkers: 0,
        decoder: { readers },
        locate: true,
      },
      (result) => {
        const codeResult = result?.codeResult;
        if (!codeResult?.code) return resolve(null);
        resolve({
          code: codeResult.code,
          format: quaggaFormatToJsBarcode(codeResult.format),
        });
      }
    );
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function quaggaFormatToJsBarcode(format) {
  if (!format) return undefined;
  const normalized = format.toLowerCase();
  const map = {
    code_128: 'CODE128',
    ean: 'EAN',
    ean_8: 'EAN8',
    ean_13: 'EAN13',
    code_39: 'CODE39',
  };
  return map[normalized] || format.toUpperCase();
}
