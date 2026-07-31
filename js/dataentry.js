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
        allowDebitTo: false, rateField: 'purchasePrice'
    },
    PurchaseReturn: {
        title: 'Purchase Return', prefix: 'PRET', partyLabel: 'Supplier',
        partyTypes: ['Supplier', 'Customer/Supplier'],
        loadAmountLabel: 'Return Amount', loadQtyLabel: 'Load Returned',
        paymentHeading: 'Refunded in Cash / Bank', balanceLabel: 'Reduces Supplier payable by',
        direction: -1, ledgerPartySide: 'Dr', paymentCashSide: 'Dr',
        allowDebitTo: false, rateField: 'purchasePrice'
    },
    Sale: {
        title: 'Sale', prefix: 'SAL', partyLabel: 'Customer',
        partyTypesCustomer: ['Customer', 'Customer/Supplier'], partyTypesRSO: ['Employee/RSO'],
        loadAmountLabel: 'Sale Amount', loadQtyLabel: 'Load Issued',
        paymentHeading: 'Received in Cash / Bank', balanceLabel: 'Balance receivable',
        direction: -1, ledgerPartySide: 'Dr', paymentCashSide: 'Dr',
        allowDebitTo: true, rateField: 'salePrice'
    },
    SaleReturn: {
        title: 'Sale Return', prefix: 'SRET', partyLabel: 'Customer',
        partyTypesCustomer: ['Customer', 'Customer/Supplier'], partyTypesRSO: ['Employee/RSO'],
        loadAmountLabel: 'Return Amount', loadQtyLabel: 'Load Returned',
        paymentHeading: 'Refunded in Cash / Bank', balanceLabel: 'Reduces receivable by',
        direction: 1, ledgerPartySide: 'Cr', paymentCashSide: 'Cr',
        allowDebitTo: true, rateField: 'salePrice'
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
function renderInvoiceList(type, searchTerm = '') {
    const tbody = $(`${type}-table-body`);
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let invoices = lfGetAll(LF_KEYS.INVOICES).filter(i => i.type === type);

    if (term) {
        invoices = invoices.filter(i =>
            (i.number || '').toLowerCase().includes(term) ||
            (i.partyName || '').toLowerCase().includes(term)
        );
    }

    invoices.sort((a, b) => new Date(b.date) - new Date(a.date));
    $(`${type}-count`).textContent = `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`;

    if (invoices.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No ${INVOICE_CONFIG[type].title.toLowerCase()} entries yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = invoices.map(inv => `
        <tr>
            <td><strong>${escapeHtml(inv.number)}</strong></td>
            <td>${escapeHtml(inv.date)}</td>
            <td>${escapeHtml(inv.partyName)}${inv.debitTo === 'RSO' ? ' <span class="type-badge">RSO</span>' : ''}</td>
            <td>${inv.hasLoad ? inv.loadQty.toLocaleString('en-US') : '-'}</td>
            <td class="num">${formatCurrency(inv.grandTotal)}</td>
            <td class="num">${inv.balanceAmount > 0 ? formatCurrency(inv.balanceAmount) : '<span class="balance-tag is-cr">Settled</span>'}</td>
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
    currentInvoiceType = type;
    const config = INVOICE_CONFIG[type];
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

    $('inv-debitto-field').classList.toggle('hidden', !config.allowDebitTo);
    if (config.allowDebitTo) {
        form.querySelector('input[name="inv-debitto"][value="Customer"]').checked = true;
    }

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

        if (config.allowDebitTo && inv.debitTo) {
            form.querySelector(`input[name="inv-debitto"][value="${inv.debitTo}"]`).checked = true;
            onDebitToChange();
        }
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
    $('invoice-modal').classList.remove('hidden');
}

function closeInvoiceForm() {
    $('invoice-modal').classList.add('hidden');
}

// ==================== PARTY (Supplier / Customer / RSO) ====================
function onDebitToChange() {
    populateInvoicePartyOptions();
}

function populateInvoicePartyOptions() {
    const config = INVOICE_CONFIG[currentInvoiceType];
    const select = $('inv-party');
    let types = config.partyTypes;

    if (config.allowDebitTo) {
        const debitTo = document.querySelector('input[name="inv-debitto"]:checked')?.value || 'Customer';
        types = debitTo === 'RSO' ? config.partyTypesRSO : config.partyTypesCustomer;
        $('inv-party-label').innerHTML = `${debitTo === 'RSO' ? 'RSO/Salesman' : 'Customer'} <span class="req">*</span>`;
    }

    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => types.includes(a.type));
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
        container.innerHTML = `<div class="item-rows-empty">No items in your catalog yet — add some under Management &gt; Add/Edit Items.</div>`;
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
    select.innerHTML = accounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)} (${a.type})</option>`).join('');
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
async function saveInvoice() {
    const config = INVOICE_CONFIG[currentInvoiceType];
    const id = $('inv-id').value;
    const date = $('inv-date').value;
    const refNumber = sanitizeInput($('inv-ref-number').value);
    const refDate = $('inv-ref-date').value;
    const partyAccountId = $('inv-party').value;
    const debitTo = config.allowDebitTo ? (document.querySelector('input[name="inv-debitto"]:checked')?.value || 'Customer') : null;
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
    const saveBtn = $('invoice-save-btn');

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

    setBtnLoading(saveBtn, true);

    try {
        // If editing, undo the previous posting first so re-saving never double-counts
        if (id) await removeLedgerEntriesForInvoice(id);

        const party = lfFindById(LF_KEYS.ACCOUNTS, partyAccountId);
        const invoiceId = id || generateId();
        const number = id ? $('inv-number').value : await takeNextDocNumber(currentInvoiceType, config.prefix);

        const writes = [];

        // ---- Post the unpaid balance to the party's account ledger ----
        if (balanceAmount > 0) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId, accountId: partyAccountId, date, type: currentInvoiceType,
                ref: number, side: config.ledgerPartySide, amount: balanceAmount,
                note: `${config.title} ${number}`
            }));
        }

        // ---- Post the paid/received portion to the Cash/Bank ledger ----
        if (paymentAmount > 0 && paymentAccountId) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId, accountId: paymentAccountId, date, type: currentInvoiceType,
                ref: number, side: config.paymentCashSide, amount: paymentAmount,
                note: `${config.title} ${number} — settlement`
            }));
        }

        // ---- Post to the Load Ledger (quantity only, no currency) ----
        if (hasLoad && loadQty > 0) {
            writes.push(lfUpsert(LF_KEYS.LOAD_LEDGER, {
                invoiceId, date, type: currentInvoiceType, ref: number,
                qtyChange: loadQty * config.direction,
                note: `${config.title} ${number} — ${party ? party.title : ''}`
            }));
        }

        // ---- Post to each Item's ledger ----
        items.forEach(row => {
            writes.push(lfUpsert(LF_KEYS.ITEM_LEDGER, {
                invoiceId, date, type: currentInvoiceType, ref: number,
                itemId: row.itemId, itemName: row.itemName,
                qtyChange: row.qty * config.direction,
                note: `${config.title} ${number}`
            }));
        });

        await Promise.all(writes);

        // ---- Save the invoice document itself ----
        await lfUpsert(LF_KEYS.INVOICES, {
            id: invoiceId, type: currentInvoiceType, number, date, refNumber, refDate,
            partyAccountId, partyName: party ? party.title : '', debitTo,
            hasLoad, loadAmount, loadDiscount, loadQty,
            items, itemsTotal, loadTotal, grandTotal,
            paymentMode, paymentAccountId, paymentAmount, balanceAmount,
            createdAt: id ? undefined : new Date().toISOString(),
            enteredBy: id ? undefined : getCurrentUserDisplayName(),
            lastEditedBy: getCurrentUserDisplayName()
        });

        showToast(`${config.title} ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        logActivity(id ? 'Updated' : 'Created', config.title, number);
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
    if (!confirm(`Delete ${inv.number}? This also removes everything it posted to the ledgers.`)) return;

    try {
        await removeLedgerEntriesForInvoice(id);
        await lfDelete(LF_KEYS.INVOICES, id);
        showToast('Invoice deleted.', 'success');
        logActivity('Deleted', inv.type, inv.number);
    } catch (e) {
        console.error('[DataEntry] Delete failed:', e);
        showToast('Could not delete — please try again.', 'error');
    }
}

// ==================== INIT: draw every invoice list once the app loads ====================
document.addEventListener('DOMContentLoaded', () => {
    Object.keys(INVOICE_CONFIG).forEach(type => renderInvoiceList(type));
});
