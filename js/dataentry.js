/**
 * LedgerFlow - Data Entry module (Purchase / Purchase Return / Sale / Sale Return)
 *
 * All four screens share one invoice form and one posting engine, because
 * structurally they're the same document — Load (intangible, its own
 * ledger) plus optional tangible Item rows — just pointed at a different
 * party and running in the opposite ledger direction.
 */

const INVOICE_CONFIG = {
    Purchase: {
        title: 'Purchase', prefix: 'PUR', partyLabel: 'Supplier',
        partyTypes: ['Supplier', 'Customer/Supplier'],
        loadAmountLabel: 'Purchase Amount', loadQtyLabel: 'Load Received',
        paymentHeading: 'Paid in Cash / Bank', balanceLabel: 'Balance payable to Supplier',
        direction: 1, ledgerPartySide: 'Cr', paymentCashSide: 'Cr',
        rateField: 'purchasePrice'
    },
    PurchaseReturn: {
        title: 'Purchase Return', prefix: 'PRET', partyLabel: 'Supplier',
        partyTypes: ['Supplier', 'Customer/Supplier'],
        loadAmountLabel: 'Return Amount', loadQtyLabel: 'Load Returned',
        paymentHeading: 'Refunded in Cash / Bank', balanceLabel: 'Reduces Supplier payable by',
        direction: -1, ledgerPartySide: 'Dr', paymentCashSide: 'Dr',
        rateField: 'purchasePrice'
    },
    Sale: {
        title: 'Sale', prefix: 'SAL', partyLabel: 'RSO',
        partyTypes: ['Employee/RSO'],
        loadAmountLabel: 'Sale Amount', loadQtyLabel: 'Load Issued',
        paymentHeading: 'Received in Cash / Bank', balanceLabel: 'Balance receivable',
        direction: -1, ledgerPartySide: 'Dr', paymentCashSide: 'Dr',
        rateField: 'salePrice'
    },
    SaleReturn: {
        title: 'Sale Return', prefix: 'SRET', partyLabel: 'RSO',
        partyTypes: ['Employee/RSO'],
        loadAmountLabel: 'Return Amount', loadQtyLabel: 'Load Returned',
        paymentHeading: 'Refunded in Cash / Bank', balanceLabel: 'Reduces receivable by',
        direction: 1, ledgerPartySide: 'Cr', paymentCashSide: 'Cr',
        rateField: 'salePrice'
    }
};

let currentInvoiceType = 'Purchase';
let itemRowCounter = 0;

// ==================== ACCOUNT BALANCE (opening + every ledger movement since) ====================
function computeAccountBalance(accountId) {
    const acc = lfFindById(LF_KEYS.ACCOUNTS, accountId);
    if (!acc) return { amount: 0, side: 'Dr' };

    let net = (acc.openingSide === 'Cr' ? -1 : 1) * (acc.openingAmount || 0);
    lfGetAll(LF_KEYS.ACCOUNT_LEDGER)
        .filter(e => e.accountId === accountId)
        .forEach(e => { net += (e.side === 'Cr' ? -1 : 1) * e.amount; });

    return { amount: Math.abs(net), side: net >= 0 ? 'Dr' : 'Cr' };
}

// ==================== LIST / RENDER ====================
function renderInvoiceList(type) {
    const tbody = $(`${type}-table-body`);
    if (!tbody) return;

    const term = ($(`${type}-search`)?.value || '').trim().toLowerCase();
    let invoices = lfGetAll(LF_KEYS.INVOICES).filter(i => i.type === type);

    if (term) {
        invoices = invoices.filter(i =>
            (i.number || '').toLowerCase().includes(term) ||
            (i.partyName || '').toLowerCase().includes(term) ||
            (i.date || '').includes(term)
        );
    }

    invoices = applyDateFilter(invoices, `${type}-from`, `${type}-to`);
    invoices.sort((a, b) => new Date(b.date) - new Date(a.date));
    $(`${type}-count`).textContent = `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`;

    if (invoices.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No ${INVOICE_CONFIG[type].title.toLowerCase()} entries yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = invoices.map(inv => `
        <tr class="${inv.cancelled ? 'cancelled-row' : ''}">
            <td><strong>${escapeHtml(inv.number)}</strong>${inv.cancelled ? ' <span class="badge-cancelled">Cancelled</span>' : ''}</td>
            <td>${escapeHtml(inv.date)}</td>
            <td>${escapeHtml(inv.partyName)}</td>
            <td>${inv.hasLoad ? inv.loadQty.toLocaleString('en-US') : '-'}</td>
            <td class="num">${formatCurrency(inv.grandTotal)}</td>
            <td class="num">${inv.cancelled ? '<span class="badge-cancelled">Cancelled</span>' : (inv.balanceAmount > 0 ? formatCurrency(inv.balanceAmount) : '<span class="balance-tag is-cr">Settled</span>')}</td>
            <td>${escapeHtml(inv.enteredBy) || '-'}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openInvoiceForm('${type}','${inv.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteInvoice('${inv.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ==================== FORM: OPEN / CLOSE ====================
function openInvoiceForm(type, editId = null) {
    const config = INVOICE_CONFIG[type];
    if (!hasRight('DATA ENTRY', config.title, 'Edit')) {
        showToast(`You don't have permission to ${editId ? 'edit' : 'add'} ${config.title} entries.`, 'warning');
        return;
    }
    if (editId) {
        const existing = lfFindById(LF_KEYS.INVOICES, editId);
        if (existing && checkLockbackOrWarn(existing.date, 'edit this invoice')) return;
    }
    currentInvoiceType = type;
    const form = $('invoice-form');
    form.reset();
    $('inv-id').value = '';
    $('inv-type').value = type;
    $('inv-item-rows').innerHTML = '';
    itemRowCounter = 0;
    renderItemRows();

    $('invoice-modal-title').textContent = editId ? `Edit ${config.title}` : `New ${config.title}`;
    $('inv-load-amount-label').textContent = config.loadAmountLabel;
    $('inv-load-qty-label').textContent = config.loadQtyLabel;
    $('inv-payment-heading').textContent = config.paymentHeading;
    $('inv-balance-label').textContent = config.balanceLabel;
    $('inv-party-label').innerHTML = `${config.partyLabel} <span class="req">*</span>`;

    populateInvoicePartyOptions();
    populatePaymentAccountOptions();

    $('inv-has-load').checked = true;
    onLoadToggle();
    $('inv-payment-mode').value = 'None';
    onPaymentModeChange();

    if (editId) {
        const inv = lfFindById(LF_KEYS.INVOICES, editId);
        if (!inv) { showToast('Invoice not found.', 'error'); return; }

        const note = $('inv-entered-by-note');
        if (inv.enteredBy) {
            note.textContent = `Entered by ${inv.enteredBy}` + (inv.lastEditedBy && inv.lastEditedBy !== inv.enteredBy ? ` · last edited by ${inv.lastEditedBy}` : '');
            note.classList.remove('hidden');
        } else {
            note.classList.add('hidden');
        }

        $('inv-id').value = inv.id;
        $('inv-number').value = inv.number;
        $('inv-date').value = inv.date;
        $('inv-ref-number').value = inv.refNumber || '';
        $('inv-ref-date').value = inv.refDate || '';

        $('inv-party').value = inv.partyAccountId;
        onInvoicePartyChange();

        $('inv-has-load').checked = !!inv.hasLoad;
        onLoadToggle();
        if (inv.hasLoad) {
            $('inv-load-amount').value = inv.loadAmount.toLocaleString('en-US');
            $('inv-load-discount').value = inv.loadDiscount;
            $('inv-load-qty').value = inv.loadQty.toLocaleString('en-US');
        }

        applyItemRowValues(inv.items);

        $('inv-payment-mode').value = inv.paymentMode || 'None';
        onPaymentModeChange();
        if (inv.paymentMode && inv.paymentMode !== 'None') {
            $('inv-payment-account').value = inv.paymentAccountId || '';
            $('inv-payment-amount').value = (inv.paymentAmount || 0).toLocaleString('en-US');
        }
    } else {
        $('inv-number').value = peekNextDocNumber(type, INVOICE_CONFIG[type].prefix);
        $('inv-date').value = new Date().toISOString().slice(0, 10);
        $('inv-entered-by-note').classList.add('hidden');
    }

    recalcTotals();
    const cancelRow = $('inv-cancel-row');
    const cancelCb = $('inv-cancelled');
    if (editId) {
        const inv = lfFindById(LF_KEYS.INVOICES, editId);
        cancelRow.classList.remove('hidden');
        cancelCb.checked = !!(inv && inv.cancelled);
    } else {
        cancelRow.classList.add('hidden');
        cancelCb.checked = false;
    }

    $('invoice-modal').classList.remove('hidden');
}

function printInvoice() {
    const invId = $('inv-id').value;
    const inv = invId ? lfFindById(LF_KEYS.INVOICES, invId) : null;
    if (!inv) { showToast('Save the invoice first before printing.', 'warning'); return; }
    openPrintWindow(buildInvoicePrintData(inv));
}

function buildInvoicePrintData(inv) {
    const config = INVOICE_CONFIG[inv.type];
    const items = (inv.items || []).filter(i => i.qty > 0).map(i => {
        const item = lfFindById(LF_KEYS.ITEMS, i.itemId);
        return { name: item ? item.name : i.itemId, qty: i.qty, rate: i.rate, amount: i.amount };
    });
    return {
        title: config.title, number: inv.number, date: inv.date,
        partyLabel: config.partyLabel, partyName: inv.partyName || '',
        refNumber: inv.refNumber, refDate: inv.refDate,
        hasLoad: inv.hasLoad, loadAmount: inv.loadAmount, loadDiscount: inv.loadDiscount, loadQty: inv.loadQty,
        items, itemsTotal: inv.itemsTotal || 0, loadTotal: inv.loadTotal || 0, grandTotal: inv.grandTotal,
        paymentMode: inv.paymentMode, paymentAmount: inv.paymentAmount || 0,
        balanceAmount: inv.balanceAmount || 0, cancelled: inv.cancelled
    };
}

function openPrintWindow(data) {
    const s = lfGetSettings();
    const logo = s.companyLogo ? `<img src="${s.companyLogo}" style="max-height:50px;max-width:120px;margin-bottom:4px">` : '';
    const companyInfo = [s.companyAddress, s.companyCity, s.companyPhone ? '+92 ' + s.companyPhone : '', s.companyEmail].filter(Boolean).join(' | ');
    const ntnGst = [s.companyNTN ? 'NTN: ' + s.companyNTN : '', s.companyGST ? 'GST: ' + s.companyGST : ''].filter(Boolean).join(' | ');

    const itemRows = data.items.map((i, idx) =>
        `<tr><td>${idx + 1}</td><td>${escapeHtml(i.name)}</td><td class="r">${i.qty}</td><td class="r">${formatCurrency(i.rate)}</td><td class="r">${formatCurrency(i.amount)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${data.title} ${data.number}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#222;padding:15mm 12mm}
.header{text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:14px}
.header h1{font-size:18px;margin:4px 0 2px}
.header .info{font-size:10px;color:#555}
.meta{display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px}
.meta-box{border:1px solid #ccc;border-radius:4px;padding:6px 10px;min-width:45%}
.meta-box strong{display:block;font-size:10px;text-transform:uppercase;color:#888;margin-bottom:2px}
table{width:100%;border-collapse:collapse;margin:10px 0}
th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;padding:6px 8px;border:1px solid #ccc;text-align:left}
td{padding:5px 8px;border:1px solid #ddd;font-size:11px}
.r{text-align:right}
.totals{margin:10px 0;text-align:right;font-size:12px;line-height:1.8}
.totals .label{display:inline-block;min-width:130px;text-align:right;margin-right:10px;color:#555}
.totals .val{display:inline-block;min-width:100px;font-weight:700;text-align:right}
.grand{font-size:14px;border-top:2px solid #333;padding-top:6px;margin-top:4px}
.cancelled-stamp{color:#e74c3c;font-weight:800;font-size:16px;text-align:center;border:2px solid #e74c3c;padding:4px;margin:10px 0;text-transform:uppercase}
.footer{margin-top:30px;display:flex;justify-content:space-between;font-size:11px;color:#888}
.sig-line{border-top:1px solid #aaa;width:150px;text-align:center;padding-top:4px}
@media print{body{padding:10mm}}
</style></head><body>
<div class="header">${logo}<h1>${escapeHtml(s.companyName || 'LedgerFlow')}</h1>
${companyInfo ? `<div class="info">${escapeHtml(companyInfo)}</div>` : ''}
${ntnGst ? `<div class="info">${escapeHtml(ntnGst)}</div>` : ''}</div>
<h2 style="text-align:center;font-size:14px;margin-bottom:12px">${data.title} — ${data.number}</h2>
${data.cancelled ? '<div class="cancelled-stamp">Cancelled</div>' : ''}
<div class="meta">
<div class="meta-box"><strong>${escapeHtml(data.partyLabel)}</strong>${escapeHtml(data.partyName)}</div>
<div class="meta-box" style="text-align:right"><strong>Date</strong>${data.date}${data.refNumber ? `<br><strong style="margin-top:4px">Ref</strong>${escapeHtml(data.refNumber)}${data.refDate ? ' (' + data.refDate + ')' : ''}` : ''}</div>
</div>
${data.hasLoad ? `<table><thead><tr><th>Load Amount</th><th class="r">Discount %</th><th class="r">Load Qty</th></tr></thead>
<tbody><tr><td>${formatCurrency(data.loadAmount)}</td><td class="r">${data.loadDiscount}%</td><td class="r">${(data.loadQty || 0).toLocaleString('en-US')}</td></tr></tbody></table>` : ''}
${data.items.length ? `<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${itemRows}</tbody></table>` : ''}
<div class="totals">
${data.hasLoad ? `<div><span class="label">Load Total:</span><span class="val">${formatCurrency(data.loadTotal)}</span></div>` : ''}
${data.items.length ? `<div><span class="label">Items Total:</span><span class="val">${formatCurrency(data.itemsTotal)}</span></div>` : ''}
<div class="grand"><span class="label">Grand Total:</span><span class="val">${formatCurrency(data.grandTotal)}</span></div>
${data.paymentMode && data.paymentMode !== 'None' && data.paymentAmount > 0 ? `<div><span class="label">Paid (${data.paymentMode}):</span><span class="val">${formatCurrency(data.paymentAmount)}</span></div>` : ''}
${data.balanceAmount > 0 ? `<div><span class="label">Balance:</span><span class="val">${formatCurrency(data.balanceAmount)}</span></div>` : ''}
</div>
<div class="footer"><div class="sig-line">Prepared By</div><div class="sig-line">Received By</div></div>
<script>window.print();<\/script></body></html>`;

    const w = window.open('', '_blank', 'width=420,height=650');
    w.document.write(html);
    w.document.close();
}

function closeInvoiceForm() {
    $('invoice-modal').classList.add('hidden');
}

// ==================== PARTY (Supplier / Customer) ====================
function populateInvoicePartyOptions() {
    const config = INVOICE_CONFIG[currentInvoiceType];
    const select = $('inv-party');
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => config.partyTypes.includes(a.type));
    select.innerHTML = '<option value="">Select…</option>' +
        accounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join('');
    $('inv-party-balance').textContent = '';
}

function onInvoicePartyChange() {
    const accountId = $('inv-party').value;
    if (!accountId) { $('inv-party-balance').textContent = ''; return; }
    const bal = computeAccountBalance(accountId);
    $('inv-party-balance').textContent = `Current balance: ${formatCurrency(bal.amount)} ${bal.side}`;
}

// ==================== LOAD BLOCK (bidirectional Amount ⇄ Discount ⇄ Qty) ====================
function onLoadToggle() {
    const on = $('inv-has-load').checked;
    $('inv-load-fields').classList.toggle('hidden', !on);
    recalcTotals();
}

function onLoadFieldInput(field) {
    const amountInput = $('inv-load-amount');
    const discountInput = $('inv-load-discount');
    const qtyInput = $('inv-load-qty');

    if (field === 'amount') formatAmountInput(amountInput);
    if (field === 'qty') formatAmountInput(qtyInput);

    const amount = parseAmount(amountInput.value);
    const discount = parseFloat(discountInput.value) || 0;
    const qty = parseAmount(qtyInput.value);

    if (field === 'discount' && amount > 0) {
        qtyInput.value = trimNumber(amount * (1 + discount / 100));
    } else if (field === 'qty' && amount > 0 && qtyInput.value !== '') {
        discountInput.value = trimPercent(((qty / amount) - 1) * 100);
    } else if (field === 'amount') {
        if (discountInput.value !== '') {
            qtyInput.value = trimNumber(amount * (1 + discount / 100));
        } else if (qtyInput.value !== '' && amount > 0) {
            discountInput.value = trimPercent(((qty / amount) - 1) * 100);
        }
    }

    recalcTotals();
}

function trimNumber(num) {
    return String(Math.round(num * 100) / 100);
}

// Rounds away binary floating-point noise (e.g. 2.6000000000000023) while
// keeping genuine precision for values that really do have many decimals.
function trimPercent(num) {
    return String(parseFloat(num.toFixed(10)));
}

// ==================== ITEM ROWS ====================
// One row per catalog item, always shown — the person just types a
// quantity into whichever items are actually part of this invoice and
// leaves the rest blank. Nothing to add or remove.
function renderItemRows() {
    const config = INVOICE_CONFIG[currentInvoiceType];
    const container = $('inv-item-rows');
    const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));

    if (items.length === 0) {
        container.innerHTML = `<div class="item-rows-empty">No items in your catalog yet — add some under Sales/Purchase &gt; Add/Edit Items.</div>`;
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="item-row" data-item-id="${item.id}">
            <span class="rights-item-name">${escapeHtml(item.name)}</span>
            <input type="text" inputmode="decimal" placeholder="0" oninput="onItemRowChange('${item.id}')">
            <input type="text" inputmode="decimal" placeholder="${item[config.rateField] || 0}" value="${item[config.rateField] || ''}" oninput="onItemRowChange('${item.id}')">
            <span class="row-amount">Rs. 0</span>
        </div>
    `).join('');
}

function onItemRowChange(itemId) {
    const row = document.querySelector(`.item-row[data-item-id="${itemId}"]`);
    if (!row) return;
    updateRowAmount(row);
    recalcTotals();
}

function updateRowAmount(row) {
    const inputs = row.querySelectorAll('input');
    const qty = parseAmount(inputs[0].value);
    const rate = parseAmount(inputs[1].value);
    row.querySelector('.row-amount').textContent = formatCurrency(qty * rate);
}

// Fills in saved qty/rate onto the matching pre-rendered row when editing an invoice
function applyItemRowValues(savedItems) {
    (savedItems || []).forEach(saved => {
        const row = document.querySelector(`.item-row[data-item-id="${saved.itemId}"]`);
        if (!row) return;
        const inputs = row.querySelectorAll('input');
        inputs[0].value = saved.qty;
        inputs[1].value = saved.rate;
        updateRowAmount(row);
    });
}

function getItemRows() {
    return [...document.querySelectorAll('#inv-item-rows .item-row')].map(row => {
        const itemId = row.dataset.itemId;
        const item = lfFindById(LF_KEYS.ITEMS, itemId);
        const inputs = row.querySelectorAll('input');
        const qty = parseAmount(inputs[0].value);
        const rate = parseAmount(inputs[1].value);
        return { itemId, itemName: item ? item.name : '', qty, rate, amount: qty * rate };
    }).filter(r => r.qty > 0);
}

// ==================== TOTALS ====================
function recalcTotals() {
    const itemsTotal = getItemRows().reduce((sum, r) => sum + r.amount, 0);
    const loadTotal = $('inv-has-load').checked ? parseAmount($('inv-load-amount').value) : 0;
    const grandTotal = itemsTotal + loadTotal;

    $('inv-items-total').textContent = formatCurrency(itemsTotal);
    $('inv-load-total').textContent = formatCurrency(loadTotal);
    $('inv-grand-total').textContent = formatCurrency(grandTotal);

    updateBalancePreview(grandTotal);
    return { itemsTotal, loadTotal, grandTotal };
}

// ==================== PAYMENT ====================
function populatePaymentAccountOptions() {
    const select = $('inv-payment-account');
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Cash' || a.type === 'Bank');
    select.innerHTML = accounts.map(a => `<option value="${a.id}">${escapeHtml(acctLabel(a))}</option>`).join('');
}

function onPaymentModeChange() {
    const mode = $('inv-payment-mode').value;
    const showFields = mode !== 'None';
    $('inv-payment-account-field').classList.toggle('hidden', !showFields);
    $('inv-payment-amount-row').classList.toggle('hidden', !showFields);
    if (!showFields) $('inv-payment-amount').value = '';
    recalcTotals();
}

function onPaymentAmountInput() {
    formatAmountInput($('inv-payment-amount'));
    recalcTotals();
}

function updateBalancePreview(grandTotal) {
    const mode = $('inv-payment-mode').value;
    const paid = mode === 'None' ? 0 : parseAmount($('inv-payment-amount').value);
    const balance = Math.max(grandTotal - paid, 0);
    $('inv-balance-preview').value = formatCurrency(balance);
}

// ==================== SAVE ====================
async function saveInvoice(printAfter = false) {
    const config = INVOICE_CONFIG[currentInvoiceType];
    if (!hasRight('DATA ENTRY', config.title, 'Edit')) {
        showToast("You don't have permission to save this.", 'warning');
        return;
    }
    const id = $('inv-id').value;
    const date = $('inv-date').value;
    const refNumber = sanitizeInput($('inv-ref-number').value);
    const refDate = $('inv-ref-date').value;
    const partyAccountId = $('inv-party').value;
    const hasLoad = $('inv-has-load').checked;
    const loadAmount = hasLoad ? parseAmount($('inv-load-amount').value) : 0;
    const loadDiscount = hasLoad ? (parseFloat($('inv-load-discount').value) || 0) : 0;
    // Qty normally auto-fills from Amount + Discount as you type (see
    // onLoadFieldInput), but that only fires once you touch a second field —
    // typing Amount alone and saving immediately left it blank, posting the
    // money without ever recording the load quantity. Derive it here too so
    // saving is never dependent on which fields were actually touched.
    let loadQty = hasLoad ? parseAmount($('inv-load-qty').value) : 0;
    if (hasLoad && loadQty <= 0 && loadAmount > 0) {
        loadQty = loadAmount * (1 + loadDiscount / 100);
    }
    const items = getItemRows();
    const saveBtn = printAfter ? $('invoice-saveprint-btn') : $('invoice-save-btn');

    if (!date) { showToast('Please choose a date.', 'warning'); $('inv-date').focus(); return; }
    if (!partyAccountId) { showToast(`Please select a ${config.partyLabel}.`, 'warning'); $('inv-party').focus(); return; }
    if (hasLoad && loadAmount <= 0) { showToast('Enter a Load amount, or untick "Include Load".', 'warning'); $('inv-load-amount').focus(); return; }
    if (!hasLoad && items.length === 0) { showToast('Add at least a Load entry or one item row.', 'warning'); return; }
    if (items.some(r => r.qty <= 0)) { showToast('Every item row needs a quantity greater than 0.', 'warning'); return; }

    const { itemsTotal, loadTotal, grandTotal } = recalcTotals();

    const paymentMode = $('inv-payment-mode').value;
    const paymentAccountId = paymentMode !== 'None' ? $('inv-payment-account').value : null;
    let paymentAmount = paymentMode !== 'None' ? parseAmount($('inv-payment-amount').value) : 0;
    paymentAmount = Math.min(Math.max(paymentAmount, 0), grandTotal);
    if (paymentMode !== 'None' && !paymentAccountId) {
        showToast('Select which Cash/Bank account this payment is in.', 'warning');
        return;
    }
    const balanceAmount = grandTotal - paymentAmount;

    const cancelled = !!$('inv-cancelled').checked;

    setBtnLoading(saveBtn, true);

    try {
        // Always wipe previous postings first so re-saving never double-counts
        if (id) await removeLedgerEntriesForInvoice(id);

        const party = lfFindById(LF_KEYS.ACCOUNTS, partyAccountId);
        const invoiceId = id || generateId();
        const number = id ? $('inv-number').value : await takeNextDocNumber(currentInvoiceType, config.prefix);

        // Only post to ledgers when the invoice is NOT cancelled
        if (!cancelled) {
            const writes = [];

            if (balanceAmount > 0) {
                writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                    invoiceId, accountId: partyAccountId, date, type: currentInvoiceType,
                    ref: number, side: config.ledgerPartySide, amount: balanceAmount,
                    note: `${config.title} ${number}`
                }));
            }

            if (paymentAmount > 0 && paymentAccountId) {
                writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                    invoiceId, accountId: paymentAccountId, date, type: currentInvoiceType,
                    ref: number, side: config.paymentCashSide, amount: paymentAmount,
                    note: `${config.title} ${number} — settlement`
                }));
            }

            if (hasLoad && loadQty > 0) {
                writes.push(lfUpsert(LF_KEYS.LOAD_LEDGER, {
                    invoiceId, date, type: currentInvoiceType, ref: number,
                    qtyChange: loadQty * config.direction,
                    amountChange: loadAmount * config.direction,
                    note: `${config.title} ${number} — ${party ? party.title : ''}`
                }));
            }

            items.forEach(row => {
                writes.push(lfUpsert(LF_KEYS.ITEM_LEDGER, {
                    invoiceId, date, type: currentInvoiceType, ref: number,
                    itemId: row.itemId, itemName: row.itemName,
                    qtyChange: row.qty * config.direction,
                    note: `${config.title} ${number}`
                }));
            });

            await Promise.all(writes);
        }

        // Snapshot the stored invoice before overwriting it. The ledger
        // rewrite above doesn't touch the invoice document, so this is
        // still the pre-edit version.
        const before = id ? { ...(lfFindById(LF_KEYS.INVOICES, id) || {}) } : null;

        // ---- Save the invoice document itself ----
        const record = {
            id: invoiceId, type: currentInvoiceType, number, date, refNumber, refDate,
            partyAccountId, partyName: party ? party.title : '',
            hasLoad, loadAmount, loadDiscount, loadQty,
            items, itemsTotal, loadTotal, grandTotal,
            paymentMode, paymentAccountId, paymentAmount, balanceAmount,
            cancelled,
            createdAt: id ? undefined : new Date().toISOString(),
            enteredBy: id ? undefined : getCurrentUserDisplayName(),
            lastEditedBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.INVOICES, record);

        showToast(`${config.title} ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        logActivity(id ? 'Updated' : 'Created', config.title, number, {
            before,
            after: { ...record, enteredBy: before?.enteredBy || record.enteredBy },
            recordId: invoiceId
        });
        if (printAfter) {
            openPrintWindow(buildInvoicePrintData(record));
        }
        closeInvoiceForm();
    } catch (e) {
        console.error('[DataEntry] Save failed:', e);
        showToast('Something went wrong while saving. Please try again.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function removeLedgerEntriesForInvoice(invoiceId) {
    await Promise.all([
        lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, invoiceId),
        lfDeleteWhereInvoiceId(LF_KEYS.LOAD_LEDGER, invoiceId),
        lfDeleteWhereInvoiceId(LF_KEYS.ITEM_LEDGER, invoiceId)
    ]);
}

async function deleteInvoice(id) {
    const inv = lfFindById(LF_KEYS.INVOICES, id);
    if (!inv) return;
    if (checkLockbackOrWarn(inv.date, 'delete this invoice')) return;
    if (!confirm(`Delete ${inv.number}? This also removes everything it posted to the ledgers.`)) return;

    try {
        await removeLedgerEntriesForInvoice(id);
        await lfDelete(LF_KEYS.INVOICES, id);
        showToast('Invoice deleted.', 'success');
        logActivity('Deleted', inv.type, inv.number, { before: inv, recordId: id });
    } catch (e) {
        console.error('[DataEntry] Delete failed:', e);
        showToast('Could not delete — please try again.', 'error');
    }
}

// ==================== CANCEL TOGGLE (shared by invoices + vouchers) ====================
function onCancelToggle(checkbox, docType) {
    const label = docType === 'invoice' ? 'invoice' : 'voucher';
    if (checkbox.checked) {
        if (!confirm(`Are you sure you want to cancel this ${label}? Its ledger entries will be removed when you save.`)) {
            checkbox.checked = false;
        }
    }
}

// ==================== INIT: draw every invoice list once the app loads ====================
document.addEventListener('DOMContentLoaded', () => {
    Object.keys(INVOICE_CONFIG).forEach(type => renderInvoiceList(type));
});
