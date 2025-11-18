const DB_NAME = 'voucher-manager-db';
const DB_VERSION = 4;
const STORE_NAME = 'vouchers';
const PAYMENTS_STORE = 'payments';

/**
 * @typedef {Object} Voucher
 * @property {string} id
 * @property {string} merchantName
 * @property {number} initialAmount
 * @property {number} currentBalance
 * @property {string} currency
 * @property {string} [barcode]
 * @property {string} [barcodeType]
 * @property {string} [expirationDate]
 * @property {string} [notes]
 * @property {string} created_at
 */

/**
 * @typedef {Object} Payment
 * @property {string} id
 * @property {string} voucherId
 * @property {number} amount
 * @property {string} created_at
 */

let dbPromise;

/**
 * Initialize the IndexedDB database and object store.
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('merchantName', 'merchantName', { unique: false });
      }
      if (!db.objectStoreNames.contains(PAYMENTS_STORE)) {
        const payments = db.createObjectStore(PAYMENTS_STORE, { keyPath: 'id' });
        payments.createIndex('voucherId', 'voucherId', { unique: false });
        payments.createIndex('created_at', 'created_at', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function generateKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getStore(storeName, mode = 'readonly') {
  const db = await initDB();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

export async function getAllVouchers() {
  const store = await getStore(STORE_NAME, 'readonly');
  const results = await wrapRequest(store.getAll());
  return results.map((voucher) => ({
    created_at: voucher.created_at || new Date().toISOString(),
    ...voucher,
  }));
}

export async function addVoucher(voucher) {
  const payload = {
    ...voucher,
    created_at: voucher.created_at || new Date().toISOString(),
    currentBalance: voucher.currentBalance ?? voucher.initialAmount ?? 0,
  };
  const store = await getStore(STORE_NAME, 'readwrite');
  await wrapRequest(store.add(payload));
}

export async function updateVoucher(voucher) {
  const payload = {
    ...voucher,
    created_at: voucher.created_at || new Date().toISOString(),
  };
  const store = await getStore(STORE_NAME, 'readwrite');
  await wrapRequest(store.put(payload));
}

export async function deleteVoucher(id) {
  const db = await initDB();
  const tx = db.transaction([STORE_NAME, PAYMENTS_STORE], 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  const paymentsIndex = tx.objectStore(PAYMENTS_STORE).index('voucherId');
  paymentsIndex.openCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function exportVouchers() {
  const vouchers = await getAllVouchers();
  const payments = await getAllPayments();
  return JSON.stringify({ vouchers, payments }, null, 2);
}

export async function importVouchers(json) {
  const parsed = JSON.parse(json);
  const payload = Array.isArray(parsed)
    ? { vouchers: parsed, payments: [] }
    : parsed;

  if (!Array.isArray(payload.vouchers) || !Array.isArray(payload.payments)) {
    throw new Error('Invalid import data: expected { vouchers: [], payments: [] }');
  }

  const db = await initDB();
  const tx = db.transaction([STORE_NAME, PAYMENTS_STORE], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const paymentsStore = tx.objectStore(PAYMENTS_STORE);

  await Promise.all([wrapRequest(store.clear()), wrapRequest(paymentsStore.clear())]);

  for (const voucher of payload.vouchers) {
    const normalized = {
      id: String(voucher.id || generateKey()),
      merchantName: voucher.merchantName || '',
      initialAmount: Number(voucher.initialAmount) || 0,
      currentBalance: Number(voucher.currentBalance ?? voucher.initialAmount) || 0,
      currency: voucher.currency || 'EUR',
      barcode: voucher.barcode || '',
      barcodeType: voucher.barcodeType || '',
      expirationDate: voucher.expirationDate || '',
      notes: voucher.notes || '',
      created_at: voucher.created_at || new Date().toISOString(),
    };
    await wrapRequest(store.put(normalized));
  }

  for (const payment of payload.payments) {
    const normalizedPayment = {
      id: String(payment.id || generateKey()),
      voucherId: String(payment.voucherId || ''),
      amount: Number(payment.amount) || 0,
      created_at: payment.created_at || new Date().toISOString(),
    };
    if (!normalizedPayment.voucherId) continue;
    await wrapRequest(paymentsStore.put(normalizedPayment));
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAllPayments() {
  const store = await getStore(PAYMENTS_STORE, 'readonly');
  return wrapRequest(store.getAll());
}

export async function getPaymentsByVoucher(voucherId) {
  const store = await getStore(PAYMENTS_STORE, 'readonly');
  const index = store.index('voucherId');
  return new Promise((resolve, reject) => {
    const results = [];
    const req = index.openCursor(IDBKeyRange.only(voucherId));
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addPayment({ voucherId, amount, created_at }) {
  if (!voucherId) throw new Error('voucherId is required');
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount === 0)
    throw new Error('Payment amount must be a non-zero number');

  const db = await initDB();
  const tx = db.transaction([STORE_NAME, PAYMENTS_STORE], 'readwrite');
  const vouchersStore = tx.objectStore(STORE_NAME);
  const paymentsStore = tx.objectStore(PAYMENTS_STORE);

  const voucher = await new Promise((resolve, reject) => {
    const req = vouchersStore.get(voucherId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!voucher) {
    tx.abort();
    throw new Error('Voucher not found');
  }

  const remaining = Number(voucher.currentBalance ?? voucher.initialAmount ?? 0);
  const updatedBalance = Number((remaining - numericAmount).toFixed(2));
  voucher.currentBalance = updatedBalance;

  paymentsStore.add({
    id: generateKey(),
    voucherId,
    amount: numericAmount,
    created_at: created_at || new Date().toISOString(),
  });

  vouchersStore.put(voucher);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
