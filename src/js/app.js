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
const paymentListEl = document.getElementById('paymentList');
const paymentCountEl = document.getElementById('paymentCount');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFile');
const resetFormBtn = document.getElementById('resetFormBtn');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const toastEl = document.getElementById('toast');

let vouchersCache = [];
let paymentsCache = [];
const expandedVoucherIds = new Set();
const noteSaveTimers = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  bindEvents();
  await refreshVouchers();
  registerServiceWorker();
  setActiveTab('wallet');
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
    showToast('Voucher created');
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
    const card = event.target.closest('.voucher-card');
    const isInteractive = event.target.closest('button, input, textarea, select, a');
    if (card && !isInteractive) {
      const id = card.dataset.id;
      const details = card.querySelector('.voucher-details');
      const isExpanded = expandedVoucherIds.has(id);
      if (isExpanded) {
        expandedVoucherIds.delete(id);
        details?.classList.add('hidden');
        card.classList.remove('expanded');
        card.classList.add('collapsed');
      } else {
        expandedVoucherIds.add(id);
        details?.classList.remove('hidden');
        card.classList.add('expanded');
        card.classList.remove('collapsed');
      }
      return;
    }

    const deleteBtn = event.target.closest('.delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const confirmDelete = confirm('Delete this voucher?');
      if (!confirmDelete) return;
      await deleteVoucher(id);
      await refreshVouchers();
    }
  });

  voucherListEl.addEventListener('input', async (event) => {
    if (!event.target.matches('.notes-form textarea')) return;
    const textarea = event.target;
    const form = textarea.closest('.notes-form');
    if (!form) return;
    const id = form.dataset.id;
    clearTimeout(noteSaveTimers.get(id));
    noteSaveTimers.set(
      id,
      setTimeout(async () => {
        const voucher = vouchersCache.find((v) => v.id === id);
        if (!voucher) return;
        const notes = textarea.value.trim();
        await updateVoucher({ ...voucher, notes });
        voucher.notes = notes;
        showToast('Notes saved');
      }, 400)
    );
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

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
}

async function refreshVouchers() {
  vouchersCache = await getAllVouchers();
  paymentsCache = await getAllPayments();
  renderVouchers(vouchersCache, paymentsCache);
  renderPayments(paymentsCache, vouchersCache);
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
      const isExpanded = expandedVoucherIds.has(voucher.id);
      const card = document.createElement('article');
      card.dataset.id = voucher.id;
      card.className = `voucher-card ${isExpanded ? 'expanded' : 'collapsed'}`;
      card.innerHTML = `
        <header>
          <div>
            <h3>${voucher.merchantName}</h3>
            <div class="voucher-meta">
              <span>${new Date(voucher.created_at).toLocaleString()}</span>
            </div>
          </div>
          <div class="balance-line" aria-label="Current balance">
          <div class="expand-icon">
                    <span class="chevron" aria-hidden="true">›</span>
                    </div>
                    <div>
            <strong>${formatCurrency(voucher.currentBalance, voucher.currency)}</strong>
            <span class="badge badge-ghost">${voucher.currency}</span>
          </div>
            </div>

        </header>
        <div class="voucher-details ${isExpanded ? '' : 'hidden'}">
          <div class="voucher-meta">
            <span>/ ${formatCurrency(voucher.initialAmount, voucher.currency)}</span>
            ${voucher.barcode ? `<span>Barcode: ${voucher.barcode}</span>` : ''}
          </div>
          <hr />
          <form class="payment-form" data-id="${voucher.id}">
            <div class="voucher-actions">
              <label style="flex: 1">
                <span>Add expense</span>
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
            </div>
            <small style="color: var(--muted);">Notes save automatically.</small>
          </form>
          <div class="voucher-meta">
            <strong>Expenses</strong>
            ${voucherPayments.length === 0 ? '<small>No expenses yet.</small>' : ''}
            ${voucherPayments
          .map(
            (p) => `<div>-${formatCurrency(p.amount, voucher.currency)} on ${new Date(p.created_at).toLocaleString()}</div>`
          )
          .join('')}
          </div>
          <div class="voucher-actions">
            <button type="button" class="secondary delete-btn" data-id="${voucher.id}">Delete</button>
          </div>
        </div>
      `;
      voucherListEl.appendChild(card);
    });
}

function renderPayments(payments, vouchers) {
  paymentListEl.innerHTML = '';
  paymentCountEl.textContent = `${payments.length} expense${payments.length === 1 ? '' : 's'}`;

  if (!payments.length) {
    paymentListEl.innerHTML = '<p>No expenses yet.</p>';
    return;
  }

  const voucherMap = vouchers.reduce((acc, v) => {
    acc[v.id] = v;
    return acc;
  }, {});

  const list = document.createElement('div');
  list.className = 'payment-items';

  payments
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .forEach((p) => {
      const voucher = voucherMap[p.voucherId];
      const item = document.createElement('div');
      item.className = 'payment-row';
      item.innerHTML = `
        <div>
          <strong>${voucher ? voucher.merchantName : 'Unknown voucher'}</strong>
          <div class="voucher-meta">${new Date(p.created_at).toLocaleString()}</div>
        </div>
        <div class="payment-amount">-${formatCurrency(p.amount, voucher?.currency || 'EUR')}</div>
      `;
      list.appendChild(item);
    });

  paymentListEl.appendChild(list);
}

function setActiveTab(tab) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab);
  });
}

let toastTimeout;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 2000);
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
