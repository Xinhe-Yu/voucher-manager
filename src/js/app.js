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
const importFileInput = document.getElementById('importFile');
const toastEl = document.getElementById('toast');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

let vouchersCache = [];
let paymentsCache = [];
const expandedVoucherIds = new Set();
const noteSaveTimers = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await refreshVouchers();
  registerServiceWorker();
  voucherApp.setActiveTab('wallet');
});

// --- fonctions privées (inchangées ou presque) ---

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

  const tpl = document.getElementById('voucher-card-template');
  const paymentTpl = document.getElementById('payment-row-template');

  const paymentsByVoucher = payments.reduce((acc, p) => {
    (acc[p.voucherId] ??= []).push(p);
    return acc;
  }, {});

  for (const voucher of vouchers.sort((a, b) => a.merchantName.localeCompare(b.merchantName))) {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.voucher-card');
    const isExpanded = expandedVoucherIds.has(voucher.id);

    // Attach ID
    card.dataset.id = voucher.id;
    card.classList.toggle('expanded', isExpanded);
    card.classList.toggle('collapsed', !isExpanded);

    // Set header fields
    node.querySelector('.voucher-merchant').textContent = voucher.merchantName;
    node.querySelector('.voucher-created').textContent = new Date(voucher.created_at).toLocaleString();
    node.querySelector('.voucher-balance').textContent = formatCurrency(voucher.currentBalance, voucher.currency);
    node.querySelector('.voucher-currency').textContent = voucher.currency;

    // Details
    const details = node.querySelector('.voucher-details');
    if (isExpanded) {
      details.classList.remove('hidden');
    } else {
      details.classList.add('hidden');
    }

    node.querySelector('.voucher-full-amount').textContent =
      `/ ${formatCurrency(voucher.initialAmount, voucher.currency)}`;

    // Forms IDs
    node.querySelector('.payment-form').dataset.id = voucher.id;
    const notesForm = node.querySelector('.notes-form');
    notesForm.dataset.id = voucher.id;
    notesForm.querySelector('textarea').value = voucher.notes || '';

    // Payments
    const paymentsContainer = node.querySelector('.voucher-expenses');
    const vp = paymentsByVoucher[voucher.id] ?? [];

    if (vp.length === 0) {
      paymentsContainer.innerHTML = '<small>No expenses yet.</small>';
    } else {
      for (const p of vp.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
        const pNode = paymentTpl.content.cloneNode(true);
        pNode.querySelector('.payment-merchant').textContent = voucher.merchantName;
        pNode.querySelector('.payment-date').textContent = new Date(p.created_at).toLocaleString();
        pNode.querySelector('.payment-amount').textContent =
          '-' + formatCurrency(p.amount, voucher.currency);
        paymentsContainer.appendChild(pNode);
      }
    }

    // Delete button
    node.querySelector('.delete-btn').dataset.id = voucher.id;

    voucherListEl.appendChild(node);
  }
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

export const voucherApp = {
  async handleVoucherFormSubmit(event) {
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
  },

  resetVoucherForm() {
    voucherForm.reset();
    voucherForm.currency.value = 'EUR';
  },

  async onVoucherListSubmit(event) {
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
  },

  async onVoucherListClick(event) {
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
  },

  async onVoucherListInput(event) {
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
      }, 400),
    );
  },

  async handleExport() {
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
  },

  openImportDialog() {
    importFileInput.click();
  },

  async handleImportFileChange(event) {
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
  },

  setActiveTab(tab) {
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.tabPanel !== tab);
    });
  },
};

// rendre accessible pour htmx (hx-on)
window.voucherApp = voucherApp;
