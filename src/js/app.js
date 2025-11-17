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
import { decodeBarcodeFromImage, renderBarcode } from './barcode.js';

const voucherForm = document.getElementById('voucherForm');
const voucherListEl = document.getElementById('voucherList');
const voucherCountEl = document.getElementById('voucherCount');
const paymentListEl = document.getElementById('paymentList');
const paymentCountEl = document.getElementById('paymentCount');
const importFileInput = document.getElementById('importFile');
const toastEl = document.getElementById('toast');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const barcodeModal = document.getElementById('barcodeModal');
const barcodeCanvas = document.getElementById('barcodeCanvas');

let vouchersCache = [];
let paymentsCache = [];
const expandedVoucherIds = new Set();

function formatPaymentAmount(amount, currency) {
  if (!Number.isFinite(amount)) return formatCurrency(amount, currency);
  if (amount === 0) return formatCurrency(0, currency);
  const formatted = formatCurrency(Math.abs(amount), currency);
  return amount > 0 ? `-${formatted}` : `+${formatted}`;
}

function getExpiryInfo(expirationDate) {
  if (!expirationDate) return null;
  const date = new Date(expirationDate);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date - today) / (1000 * 60 * 60 * 24));
  const formattedDate = date.toLocaleDateString();
  const inlineText = `Expires ${formattedDate}`;
  if (diffDays < 0) {
    return { inlineText: `${inlineText} (expired)`, badgeText: 'Expired', warning: true };
  }
  if (diffDays <= 14) {
    return {
      inlineText: `${inlineText} (in ${diffDays} day${diffDays === 1 ? '' : 's'})`,
      warning: true,
    };
  }
  return { inlineText, warning: false, badgeText: '' };
}

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
    const expiryText = node.querySelector('.voucher-expiry');

    const expiryInfo = getExpiryInfo(voucher.expirationDate);
    if (expiryText) expiryText.textContent = expiryInfo?.inlineText || '';

    const barcodeBtn = node.querySelector('.barcode-btn');
    if (!voucher.barcode) {
      barcodeBtn?.remove();
    }

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
    const noteText = voucher.notes?.trim();
    if (noteText && noteText.length > 0) {
      const notesEl = node.querySelector('.voucher-notes');
      if (notesEl) notesEl.textContent = noteText;
    } else {
      const notesEl = node.querySelector('.note-display');
      if (notesEl) notesEl.classList.add('hidden');
    }

    const editForm = node.querySelector('.edit-form');
    if (editForm) {
      editForm.dataset.id = voucher.id;
      if (editForm.voucherId) editForm.voucherId.value = voucher.id;
      if (editForm.merchantName) editForm.merchantName.value = voucher.merchantName;
      if (editForm.currency) editForm.currency.value = voucher.currency;
      if (editForm.currentBalance)
        editForm.currentBalance.value = Number(
          voucher.currentBalance ?? voucher.initialAmount ?? 0,
        ).toFixed(2);
      if (editForm.barcode) editForm.barcode.value = voucher.barcode || '';
      if (editForm.notes) editForm.notes.value = voucher.notes || '';
      if (editForm.expirationDate) editForm.expirationDate.value = voucher.expirationDate || '';
      const helper = editForm.querySelector('.balance-helper');
      if (helper) {
        helper.textContent = `${formatCurrency(voucher.currentBalance, voucher.currency)} available (initial ${formatCurrency(
          voucher.initialAmount,
          voucher.currency,
        )})`;
      }
    }

    // Payments
    const paymentsContainer = node.querySelector('.voucher-expenses');
    const vp = paymentsByVoucher[voucher.id] ?? [];

    if (vp.length === 0) {
      paymentsContainer.innerHTML = '<small>No expenses yet.</small>';
    } else {
      for (const p of vp.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
        const pNode = paymentTpl.content.cloneNode(true);
        pNode.querySelector('.payment-date').textContent = new Date(p.created_at).toLocaleString();
        const amountEl = pNode.querySelector('.payment-amount');
        amountEl.textContent = formatPaymentAmount(p.amount, voucher.currency);
        amountEl.classList.toggle('positive', p.amount < 0);
        paymentsContainer.appendChild(pNode);
      }
    }

    // Delete button
    const editBtn = node.querySelector('.edit-btn');
    if (editBtn) editBtn.dataset.id = voucher.id;
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
        <div class="payment-amount"></div>
      `;
      const amountEl = item.querySelector('.payment-amount');
      amountEl.textContent = formatPaymentAmount(p.amount, voucher?.currency || 'EUR');
      amountEl.classList.toggle('positive', p.amount < 0);
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
    const expirationDate = formData.get('expirationDate')?.toString().trim() || '';

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
      barcodeType: 'CODE128',
      notes,
      expirationDate,
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
      const voucher = vouchersCache.find((v) => v.id === id);
      if (!voucher) {
        alert('Voucher not found');
        return;
      }

      if (amount > voucher.currentBalance) {
        alert('Amount exceeds remaining balance.');
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

    if (event.target.matches('.edit-form')) {
      event.preventDefault();
      const form = event.target;
      const id = form.dataset.id || form.voucherId?.value;
      const voucher = vouchersCache.find((v) => v.id === id);
      if (!voucher) return;

      const desiredBalanceRaw = Number(form.currentBalance.value);
      if (!Number.isFinite(desiredBalanceRaw)) {
        alert('Enter a valid balance');
        return;
      }

      const desiredBalance = Number(desiredBalanceRaw.toFixed(2));
      const balanceDelta = Number((voucher.currentBalance - desiredBalance).toFixed(2));
      const notes = form.notes.value.trim();
      const barcode = form.barcode.value.trim();
      const expirationDate = form.expirationDate?.value?.trim() || '';
      const currency = form.currency.value.trim() || 'EUR';

      try {
        if (balanceDelta !== 0) {
          await addPayment({ voucherId: voucher.id, amount: balanceDelta });
        }

        const shouldUpdateVoucher =
          balanceDelta !== 0 ||
          notes !== (voucher.notes || '') ||
          barcode !== (voucher.barcode || '') ||
          expirationDate !== (voucher.expirationDate || '') ||
          currency !== (voucher.currency || 'EUR');

        if (shouldUpdateVoucher) {
          await updateVoucher({
            ...voucher,
            currentBalance: desiredBalance,
            notes,
            barcode,
            expirationDate,
            currency,
          });
        }

        const card = form.closest('.voucher-card');
        exitInlineEdit(card);
        await refreshVouchers();
        showToast('Voucher updated');
      } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to update voucher');
      }
    }
  },

  async onVoucherListClick(event) {
    const card = event.target.closest('.voucher-card');
    const isInteractive = event.target.closest('button, input, textarea, select, a');

    if (event.target.closest('.barcode-btn')) {
      event.preventDefault();
      const id = card?.dataset.id;
      if (!id) return;
      const voucher = vouchersCache.find((v) => v.id === id);
      if (!voucher || !voucher.barcode) {
        alert('No barcode saved for this voucher');
        return;
      }
      openBarcodeModal(voucher);
      return;
    }

    const editBtn = event.target.closest('.edit-btn');
    if (editBtn) {
      event.preventDefault();
      const id = editBtn.dataset.id;
      const voucher = vouchersCache.find((v) => v.id === id);
      if (voucher && card) enterInlineEdit(card, voucher);
      return;
    }

    const cancelEditBtn = event.target.closest('.edit-cancel-btn');
    if (cancelEditBtn) {
      event.preventDefault();
      exitInlineEdit(card);
      return;
    }

    const scanBtn = event.target.closest('.edit-scan-barcode');
    if (scanBtn) {
      event.preventDefault();
      const input = card?.querySelector('.edit-barcode-input');
      input?.click();
      return;
    }

    if (card && card.classList.contains('editing')) return;

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

  async onVoucherListChange(event) {
    if (event.target.matches('.edit-barcode-input')) {
      const input = event.target;
      const form = input.closest('.edit-form');
      const barcodeInput = form?.querySelector('input[name="barcode"]');
      await fillBarcodeFromImage(event, barcodeInput);
    }
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

  async handleBarcodeImageChange(event) {
    const barcodeInput = voucherForm.querySelector('input[name="barcode"]');
    await fillBarcodeFromImage(event, barcodeInput);
  },

  closeBarcodeModal(event) {
    event?.preventDefault?.();
    hideBarcodeModal();
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

function enterInlineEdit(card, voucher) {
  if (!card) return;
  const view = card.querySelector('.voucher-view');
  const edit = card.querySelector('.voucher-edit');
  const form = edit?.querySelector('.edit-form');
  if (!view || !edit || !form) return;

  form.dataset.id = voucher.id;
  if (form.voucherId) form.voucherId.value = voucher.id;
  if (form.merchantName) form.merchantName.value = voucher.merchantName;
  if (form.currency) form.currency.value = voucher.currency;
  if (form.currentBalance)
    form.currentBalance.value = Number(voucher.currentBalance ?? voucher.initialAmount ?? 0).toFixed(2);
  if (form.barcode) form.barcode.value = voucher.barcode || '';
  if (form.notes) form.notes.value = voucher.notes || '';
  if (form.expirationDate) form.expirationDate.value = voucher.expirationDate || '';

  view.classList.add('hidden');
  edit.classList.remove('hidden');
  card.classList.add('editing');
}

function exitInlineEdit(card) {
  if (!card) return;
  const view = card.querySelector('.voucher-view');
  const edit = card.querySelector('.voucher-edit');
  const form = edit?.querySelector('.edit-form');
  if (view) view.classList.remove('hidden');
  if (edit) edit.classList.add('hidden');
  if (form) form.reset();
  card.classList.remove('editing');
}

async function fillBarcodeFromImage(event, targetInput) {
  const file = event.target.files?.[0];
  if (!file || !targetInput) return;
  try {
    const result = await decodeBarcodeFromImage(file, {
      readers: ['code_128_reader', 'ean_reader', 'ean_8_reader', 'code_39_reader'],
    });
    if (result?.code) {
      targetInput.value = result.code;
      showToast('Barcode detected');
    } else {
      alert('No barcode detected in image');
    }
  } catch (err) {
    console.error(err);
    alert('Failed to decode barcode');
  } finally {
    event.target.value = '';
  }
}

function openBarcodeModal(voucher) {
  if (!barcodeModal || !barcodeCanvas) return;
  barcodeModal.classList.remove('hidden');
  renderBarcode(barcodeCanvas, voucher.barcode, {
    format: (voucher.barcodeType || 'CODE128').toUpperCase(),
    width: 2,
    height: 80,
    displayValue: true,
  }).catch((err) => console.error('Failed to render barcode', err));
}

function hideBarcodeModal() {
  if (!barcodeModal) return;
  barcodeModal.classList.add('hidden');
}
