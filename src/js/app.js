import {
  initDB,
  getAllVouchers,
  addVoucher,
  updateVoucher,
  deleteVoucher,
  exportVouchers,
  importVouchers,
  addPayment,
  getAllPayments,
} from './db.js';
import { generateId, formatCurrency } from './utils.js';

const voucherForm = document.getElementById('voucherForm');
const voucherListEl = document.getElementById('voucherList');
const voucherCountEl = document.getElementById('voucherCount');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFile');
const resetFormBtn = document.getElementById('resetFormBtn');

let vouchersCache = [];
let paymentsCache = [];

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  bindEvents();
  await refreshVouchers();
  registerServiceWorker();
});

function bindEvents() {
  voucherForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(voucherForm);
    const merchantName = formData.get('merchantName')?.toString().trim();
    const initialAmount = Number(formData.get('initialAmount'));
    const currency = formData.get('currency')?.toString().trim() || 'EUR';
    const barcode = formData.get('barcode')?.toString().trim() || '';
    const notes = formData.get('notes')?.toString().trim() || '';

    if (!merchantName || Number.isNaN(initialAmount)) {
      alert('Please fill in all required voucher fields.');
      return;
    }

    const voucher = {
      id: generateId(),
      merchantName,
      initialAmount,
      currentBalance: initialAmount,
      currency,
      barcode,
      notes,
    };

    await addVoucher(voucher);
    voucherForm.reset();
    voucherForm.currency.value = 'EUR';
    await refreshVouchers();
  });

  resetFormBtn.addEventListener('click', () => {
    voucherForm.reset();
    voucherForm.currency.value = 'EUR';
  });

  voucherListEl.addEventListener('submit', async (event) => {
    if (event.target.matches('.payment-form')) {
      event.preventDefault();
      const form = event.target;
      const id = form.dataset.id;
      const amount = Number(form.amount.value);
      if (Number.isNaN(amount) || amount <= 0) {
        alert('Enter a valid payment amount.');
        return;
      }
      try {
        await addPayment({ voucherId: id, amount });
        form.reset();
        await refreshVouchers();
      } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to add payment');
      }
      return;
    }

    if (event.target.matches('.notes-form')) {
      event.preventDefault();
      const form = event.target;
      const id = form.dataset.id;
      const voucher = vouchersCache.find((v) => v.id === id);
      if (!voucher) return;
      const notes = form.notes.value.trim();
      await updateVoucher({ ...voucher, notes });
      await refreshVouchers();
    }
  });

  voucherListEl.addEventListener('click', async (event) => {
    const deleteBtn = event.target.closest('.delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const confirmDelete = confirm('Delete this voucher?');
      if (!confirmDelete) return;
      await deleteVoucher(id);
      await refreshVouchers();
    }
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const data = await exportVouchers();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vouchers-export.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to export vouchers');
    }
  });

  importBtn.addEventListener('click', () => importFileInput.click());

  importFileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importVouchers(text);
      await refreshVouchers();
      alert('Vouchers imported successfully');
    } catch (err) {
      console.error(err);
      alert('Failed to import vouchers');
    } finally {
      importFileInput.value = '';
    }
  });
}

async function refreshVouchers() {
  vouchersCache = await getAllVouchers();
  paymentsCache = await getAllPayments();
  renderVouchers(vouchersCache, paymentsCache);
}

function renderVouchers(vouchers, payments) {
  voucherListEl.innerHTML = '';
  voucherCountEl.textContent = `${vouchers.length} item${vouchers.length === 1 ? '' : 's'}`;

  if (!vouchers.length) {
    voucherListEl.innerHTML = '<p>No vouchers yet. Add your first one above.</p>';
    return;
  }

  const paymentsByVoucher = payments.reduce((acc, payment) => {
    if (!acc[payment.voucherId]) acc[payment.voucherId] = [];
    acc[payment.voucherId].push(payment);
    return acc;
  }, {});

  vouchers
    .slice()
    .sort((a, b) => a.merchantName.localeCompare(b.merchantName))
    .forEach((voucher) => {
      const voucherPayments = (paymentsByVoucher[voucher.id] || []).sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const card = document.createElement('article');
      card.className = 'voucher-card';
      card.innerHTML = `
        <header>
          <div>
            <h3>${voucher.merchantName}</h3>
            <div class="voucher-meta">
              <span>Created: ${new Date(voucher.created_at).toLocaleString()}</span>
              <span class="badge">${voucher.currency}</span>
            </div>
          </div>
          <div class="voucher-meta" style="text-align: right;">
            <strong>${formatCurrency(voucher.currentBalance, voucher.currency)}</strong>
            <small>Initial: ${formatCurrency(voucher.initialAmount, voucher.currency)}</small>
          </div>
        </header>
        <div class="voucher-meta">
          ${voucher.barcode ? `<span>Barcode: ${voucher.barcode}</span>` : ''}
        </div>
        <hr />
        <form class="payment-form" data-id="${voucher.id}">
          <div class="voucher-actions">
            <label style="flex: 1">
              <span>Add payment</span>
              <input name="amount" type="number" step="0.01" min="0.01" placeholder="10" required />
            </label>
            <button type="submit">Add</button>
          </div>
        </form>
        <form class="notes-form" data-id="${voucher.id}">
          <div class="voucher-actions">
            <label style="flex: 1">
              <span>Notes</span>
              <textarea name="notes" rows="2" placeholder="Add notes">${voucher.notes || ''}</textarea>
            </label>
            <button type="submit" class="secondary">Save notes</button>
          </div>
        </form>
        <div class="voucher-meta">
          <strong>Payments</strong>
          ${voucherPayments.length === 0 ? '<small>No payments yet.</small>' : ''}
          ${voucherPayments
            .map(
              (p) => `<div>-${formatCurrency(p.amount, voucher.currency)} on ${new Date(p.created_at).toLocaleString()}</div>`
            )
            .join('')}
        </div>
        <div class="voucher-actions">
          <button type="button" class="secondary delete-btn" data-id="${voucher.id}">Delete</button>
        </div>
      `;
      voucherListEl.appendChild(card);
    });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.error('Service worker registration failed', err));
    });
  }
}
