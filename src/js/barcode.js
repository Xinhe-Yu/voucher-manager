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
 * Start a live barcode scan using Quagga. Caller should provide a target DOM element
 * (usually a div) where Quagga will inject the video overlay.
 * @param {{
 *  target: HTMLElement,
 *  onDetected?: (code: string) => void,
 *  onProcessed?: (result: any) => void,
 *  constraints?: MediaTrackConstraints,
 *  readers?: string[]
 * }} options
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startLiveScan({
  target,
  onDetected,
  onProcessed,
  constraints = { facingMode: 'environment' },
  readers = ['code_128_reader', 'ean_reader', 'ean_8_reader', 'code_39_reader'],
}) {
  if (!target) throw new Error('startLiveScan requires a target element');
  const Quagga = await ensureQuagga();

  await new Promise((resolve, reject) => {
    Quagga.init(
      {
        inputStream: {
          name: 'Live',
          type: 'LiveStream',
          target,
          constraints,
        },
        decoder: {
          readers,
        },
        locate: true,
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });

  if (typeof onProcessed === 'function') {
    Quagga.onProcessed(onProcessed);
  }
  if (typeof onDetected === 'function') {
    Quagga.onDetected((data) => {
      const code = data?.codeResult?.code;
      if (code) onDetected(code);
    });
  }

  Quagga.start();

  return {
    stop() {
      try {
        Quagga.stop();
        Quagga.offProcessed?.();
        Quagga.offDetected?.();
      } catch (err) {
        console.error('Failed to stop Quagga', err);
      }
    },
  };
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
    // Fallback: simple text render
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
 * Utility to stop any active Quagga session if caller lost the handle.
 */
export async function stopLiveScan() {
  const Quagga = window.Quagga;
  if (Quagga && Quagga.stop) {
    Quagga.stop();
    Quagga.offProcessed?.();
    Quagga.offDetected?.();
  }
}

/**
 * Decode a still image file using Quagga's single image mode.
 * @param {File} file
 * @param {{readers?: string[]}} [options]
 * @returns {Promise<string|null>} resolved with the detected code or null
 */
export async function decodeBarcodeFromImage(file, { readers = ['code_128_reader'] } = {}) {
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
        resolve(result?.codeResult || null);
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

/**
 * Lightweight helper that returns the same value; kept for compatibility with callers
 * expecting a synchronous encoder.
 */
export function encodeBarcodeStringToRenderableData(barcodeString) {
  return barcodeString;
}
