/**
 * LedgerFlow - Vouchers module (Bank Receipt / Bank Payment / Petty Cash / Journal Voucher)
 *
 * Bank Receipt and Bank Payment share one form (same shape, opposite Dr/Cr
 * direction — same idea as Purchase/Sale). Petty Cash and Journal Voucher
 * are each multi-line and get their own forms, reusing the ledger-posting
 * pattern already established in dataentry.js (removeLedgerEntriesForInvoice,
 * computeAccountBalance, lfUpsert, etc.)
 */

const BANK_VOUCHER_CONFIG = {
    BankReceipt: {
        title: 'Bank Receipt', prefix: 'BRV',
        bankLabel: 'Bank/Cash Account (receiving)', partyLabel: 'Received From',
        bankSide: 'Dr', partySide: 'Cr'
    },
    BankPayment: {
        title: 'Bank Payment', prefix: 'BPV',
        bankLabel: 'Bank/Cash Account (paying)', partyLabel: 'Paid To',
        bankSide: 'Cr', partySide: 'Dr'
    }
};

const VOUCHER_PREFIX = { BankReceipt: 'BRV', BankPayment: 'BPV', PettyCash: 'PCV', Journal: 'JV' };

let currentBankVoucherType = 'BankReceipt';
let pcLineCounter = 0;
let jvLineCounter = 0;

// ==================== NUMBERING (shared Firestore-backed counter from db.js) ====================
function peekNextVoucherNumber(type) {
    return peekNextDocNumber(type, VOUCHER_PREFIX[type]);
}
async function takeNextVoucherNumber(type) {
    return await takeNextDocNumber(type, VOUCHER_PREFIX[type]);
}

// ==================== SHARED LIST RENDERER ====================
function renderVoucherList(type, searchTerm = '') {
    const tbody = $(`${type}-table-body`);
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let vouchers = lfGetAll(LF_KEYS.VOUCHERS).filter(v => v.type === type);

    if (term) {
        vouchers = vouchers.filter(v =>
            (v.number || '').toLowerCase().includes(term) ||
            (v.partyName || '').toLowerCase().includes(term) ||
            (v.narration || '').toLowerCase().includes(term)
        );
    }

    vouchers.sort((a, b) => new Date(b.date) - new Date(a.date));
    $(`${type}-count`).textContent = `${vouchers.length} voucher${vouchers.length === 1 ? '' : 's'}`;

    if (vouchers.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No entries yet.</td></tr>`;
        return;
    }

    if (type === 'BankReceipt' || type === 'BankPayment') {
        tbody.innerHTML = vouchers.map(v => `
            <tr class="${v.cancelled ? 'cancelled-row' : ''}">
                <td><strong>${escapeHtml(v.number)}</strong>${v.cancelled ? ' <span class="badge-cancelled">Cancelled</span>' : ''}</td>
                <td>${escapeHtml(v.date)}</td>
                <td>${escapeHtml(v.bankName)}</td>
                <td>${escapeHtml(v.partyName)}</td>
                <td class="num">${formatCurrency(v.amount)}</td>
                <td>${escapeHtml(v.enteredBy) || '-'}</td>
                <td>
                    <div class="row-actions">
                        <button class="btn-outline-text" onclick="openBankVoucherForm('${type}','${v.id}')">Edit</button>
                        <button class="btn-danger-text" onclick="deleteVoucher('${v.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } else if (type === 'PettyCash') {
        tbody.innerHTML = vouchers.map(v => `
            <tr class="${v.cancelled ? 'cancelled-row' : ''}">
                <td><strong>${escapeHtml(v.number)}</strong>${v.cancelled ? ' <span class="badge-cancelled">Cancelled</span>' : ''}</td>
                <td>${escapeHtml(v.date)}</td>
                <td>${escapeHtml(v.cashAccountName)}</td>
                <td>${(v.lines || []).length} line${(v.lines || []).length === 1 ? '' : 's'}</td>
                <td class="num">${formatCurrency(v.total)}</td>
                <td>${escapeHtml(v.enteredBy) || '-'}</td>
                <td>
                    <div class="row-actions">
                        <button class="btn-outline-text" onclick="openPettyCashForm('${v.id}')">Edit</button>
                        <button class="btn-danger-text" onclick="deleteVoucher('${v.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } else if (type === 'Journal') {
        tbody.innerHTML = vouchers.map(v => `
            <tr class="${v.cancelled ? 'cancelled-row' : ''}">
                <td><strong>${escapeHtml(v.number)}</strong>${v.cancelled ? ' <span class="badge-cancelled">Cancelled</span>' : ''}</td>
                <td>${escapeHtml(v.date)}</td>
                <td>${escapeHtml(v.narration) || '-'}</td>
                <td>${(v.lines || []).length} line${(v.lines || []).length === 1 ? '' : 's'}</td>
                <td class="num">${formatCurrency(v.totalDr)}</td>
                <td>${escapeHtml(v.enteredBy) || '-'}</td>
                <td>
                    <div class="row-actions">
                        <button class="btn-outline-text" onclick="openJournalForm('${v.id}')">Edit</button>
                        <button class="btn-danger-text" onclick="deleteVoucher('${v.id}')">Delete</button>
                    </div>
                </td>
            </tr>
        `).join('');
    }
}

async function deleteVoucher(id) {
    const v = lfFindById(LF_KEYS.VOUCHERS, id);
    if (!v) return;
    if (checkLockbackOrWarn(v.date, 'delete this voucher')) return;
    if (!confirm(`Delete ${v.number}? This also removes everything it posted to the ledgers.`)) return;

    try {
        await removeLedgerEntriesForInvoice(id);
        await lfDelete(LF_KEYS.VOUCHERS, id);
        showToast('Voucher deleted.', 'success');
        logActivity('Deleted', v.type, v.number, { before: v, recordId: id });
    } catch (e) {
        console.error('[Vouchers] Delete failed:', e);
        showToast('Could not delete — please try again.', 'error');
    }
}

// ==================== BANK RECEIPT / BANK PAYMENT (shared form) ====================
function openBankVoucherForm(type, editId = null) {
    const config = BANK_VOUCHER_CONFIG[type];
    if (!hasRight('VOUCHERS', config.title, 'Edit')) {
        showToast(`You don't have permission to ${editId ? 'edit' : 'add'} ${config.title} entries.`, 'warning');
        return;
    }
    if (editId) {
        const existing = lfFindById(LF_KEYS.VOUCHERS, editId);
        if (existing && checkLockbackOrWarn(existing.date, 'edit this voucher')) return;
    }
    currentBankVoucherType = type;
    const form = $('bankvoucher-form');
    form.reset();
    $('bv-id').value = '';
    $('bv-type').value = type;

    $('bankvoucher-modal-title').textContent = editId ? `Edit ${config.title}` : `New ${config.title}`;
    $('bv-bank-label').innerHTML = `${config.bankLabel} <span class="req">*</span>`;
    $('bv-party-label').innerHTML = `${config.partyLabel} <span class="req">*</span>`;

    const bankAccounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Cash' || a.type === 'Bank');
    $('bv-bank-account').innerHTML = bankAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)} (${a.type})</option>`).join('');

    const partyAccounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type !== 'Cash' && a.type !== 'Bank');
    $('bv-party-account').innerHTML = '<option value="">Select…</option>' +
        partyAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join('');
    $('bv-party-balance').textContent = '';

    if (editId) {
        const v = lfFindById(LF_KEYS.VOUCHERS, editId);
        if (!v) { showToast('Voucher not found.', 'error'); return; }

        const note = $('bv-entered-by-note');
        if (v.enteredBy) {
            note.textContent = `Entered by ${v.enteredBy}` + (v.lastEditedBy && v.lastEditedBy !== v.enteredBy ? ` · last edited by ${v.lastEditedBy}` : '');
            note.classList.remove('hidden');
        } else {
            note.classList.add('hidden');
        }

        $('bv-id').value = v.id;
        $('bv-number').value = v.number;
        $('bv-date').value = v.date;
        $('bv-bank-account').value = v.bankAccountId;
        $('bv-party-account').value = v.partyAccountId;
        onBankVoucherPartyChange();
        $('bv-amount').value = v.amount.toLocaleString('en-US');
        $('bv-cheque-no').value = v.chequeNo || '';
        $('bv-cheque-date').value = v.chequeDate || '';
        $('bv-narration').value = v.narration || '';
    } else {
        $('bv-number').value = peekNextVoucherNumber(type);
        $('bv-date').value = new Date().toISOString().slice(0, 10);
        $('bv-entered-by-note').classList.add('hidden');
    }

    const bvCancelRow = $('bv-cancel-row');
    const bvCancelCb = $('bv-cancelled');
    if (editId) {
        const v = lfFindById(LF_KEYS.VOUCHERS, editId);
        bvCancelRow.classList.remove('hidden');
        bvCancelCb.checked = !!(v && v.cancelled);
    } else {
        bvCancelRow.classList.add('hidden');
        bvCancelCb.checked = false;
    }

    $('bankvoucher-modal').classList.remove('hidden');
}

function closeBankVoucherForm() {
    $('bankvoucher-modal').classList.add('hidden');
}

function onBankVoucherPartyChange() {
    const accountId = $('bv-party-account').value;
    if (!accountId) { $('bv-party-balance').textContent = ''; return; }
    const bal = computeAccountBalance(accountId);
    $('bv-party-balance').textContent = `Current balance: ${formatCurrency(bal.amount)} ${bal.side}`;
}

async function saveBankVoucher() {
    const type = $('bv-type').value;
    const config = BANK_VOUCHER_CONFIG[type];
    if (!hasRight('VOUCHERS', config.title, 'Edit')) {
        showToast("You don't have permission to save this.", 'warning');
        return;
    }
    const id = $('bv-id').value;
    const date = $('bv-date').value;
    const bankAccountId = $('bv-bank-account').value;
    const partyAccountId = $('bv-party-account').value;
    const amount = parseAmount($('bv-amount').value);
    const chequeNo = sanitizeInput($('bv-cheque-no').value);
    const chequeDate = $('bv-cheque-date').value;
    const narration = sanitizeInput($('bv-narration').value);
    const saveBtn = $('bankvoucher-save-btn');

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!bankAccountId) { showToast('Please select the Bank/Cash account.', 'warning'); return; }
    if (!partyAccountId) { showToast(`Please select who this is ${type === 'BankReceipt' ? 'received from' : 'paid to'}.`, 'warning'); return; }
    if (amount <= 0) { showToast('Enter an amount greater than 0.', 'warning'); return; }

    const bvCancelled = !!$('bv-cancelled').checked;

    setBtnLoading(saveBtn, true);

    try {
        if (id) await removeLedgerEntriesForInvoice(id);

        const bankAcc = lfFindById(LF_KEYS.ACCOUNTS, bankAccountId);
        const partyAcc = lfFindById(LF_KEYS.ACCOUNTS, partyAccountId);
        const voucherId = id || generateId();
        const number = id ? $('bv-number').value : await takeNextVoucherNumber(type);

        if (!bvCancelled) {
            await Promise.all([
                lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                    invoiceId: voucherId, accountId: bankAccountId, date, type,
                    ref: number, side: config.bankSide, amount, note: `${config.title} ${number}`
                }),
                lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                    invoiceId: voucherId, accountId: partyAccountId, date, type,
                    ref: number, side: config.partySide, amount, note: `${config.title} ${number}`
                })
            ]);
        }

        const before = id ? { ...(lfFindById(LF_KEYS.VOUCHERS, id) || {}) } : null;
        const record = {
            id: voucherId, type, number, date,
            bankAccountId, bankName: bankAcc ? bankAcc.title : '',
            partyAccountId, partyName: partyAcc ? partyAcc.title : '',
            amount, chequeNo, chequeDate, narration,
            cancelled: bvCancelled,
            createdAt: id ? undefined : new Date().toISOString(),
            enteredBy: id ? undefined : getCurrentUserDisplayName(),
            lastEditedBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.VOUCHERS, record);

        showToast(`${config.title} ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        logActivity(id ? 'Updated' : 'Created', config.title, number,
                    { before, after: { ...record, enteredBy: before?.enteredBy || record.enteredBy }, recordId: voucherId });
        closeBankVoucherForm();
    } catch (e) {
        console.error('[Vouchers] Save failed:', e);
        showToast('Something went wrong while saving. Please try again.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

// ==================== PETTY CASH ====================
function openPettyCashForm(editId = null) {
    if (!hasRight('VOUCHERS', 'Petty Cash', 'Edit')) {
        showToast(`You don't have permission to ${editId ? 'edit' : 'add'} Petty Cash entries.`, 'warning');
        return;
    }
    if (editId) {
        const existing = lfFindById(LF_KEYS.VOUCHERS, editId);
        if (existing && checkLockbackOrWarn(existing.date, 'edit this voucher')) return;
    }
    const form = $('pettycash-form');
    form.reset();
    $('pc-id').value = '';
    $('pc-lines').innerHTML = '';
    pcLineCounter = 0;

    // Petty Cash is by definition paid out of Cash-in-hand — Bank accounts don't belong here.
    const cashAccounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Cash');
    $('pc-cash-account').innerHTML = cashAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join('');

    if (editId) {
        const v = lfFindById(LF_KEYS.VOUCHERS, editId);
        if (!v) { showToast('Voucher not found.', 'error'); return; }

        const note = $('pc-entered-by-note');
        if (v.enteredBy) {
            note.textContent = `Entered by ${v.enteredBy}` + (v.lastEditedBy && v.lastEditedBy !== v.enteredBy ? ` · last edited by ${v.lastEditedBy}` : '');
            note.classList.remove('hidden');
        } else {
            note.classList.add('hidden');
        }

        $('pc-id').value = v.id;
        $('pc-number').value = v.number;
        $('pc-date').value = v.date;
        $('pc-cash-account').value = v.cashAccountId;
        (v.lines || []).forEach(line => addPettyCashLine(line));
    } else {
        $('pc-number').value = peekNextVoucherNumber('PettyCash');
        $('pc-date').value = new Date().toISOString().slice(0, 10);
        $('pc-entered-by-note').classList.add('hidden');
        if (cashAccounts.length) $('pc-cash-account').value = cashAccounts[0].id;
        addPettyCashLine();
    }

    recalcPettyCashTotal();

    const pcCancelRow = $('pc-cancel-row');
    const pcCancelCb = $('pc-cancelled');
    if (editId) {
        const v = lfFindById(LF_KEYS.VOUCHERS, editId);
        pcCancelRow.classList.remove('hidden');
        pcCancelCb.checked = !!(v && v.cancelled);
    } else {
        pcCancelRow.classList.add('hidden');
        pcCancelCb.checked = false;
    }

    $('pettycash-modal').classList.remove('hidden');
}

function closePettyCashForm() {
    $('pettycash-modal').classList.add('hidden');
}

function addPettyCashLine(prefill = null) {
    pcLineCounter++;
    const lineId = `pcline${pcLineCounter}`;
    const container = $('pc-lines');

    const expenseAccounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Expense');
    const options = expenseAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join('');

    const row = document.createElement('div');
    row.className = 'pc-line';
    row.dataset.lineId = lineId;
    row.innerHTML = `
        <select onchange="recalcPettyCashTotal()"><option value="">Select expense head…</option>${options}</select>
        <input type="text" inputmode="decimal" placeholder="0" oninput="formatAmountInput(this); recalcPettyCashTotal()">
        <input type="text" placeholder="Narration">
        <button type="button" class="item-row-remove" title="Remove" onclick="removePettyCashLine('${lineId}')">✕</button>
    `;
    container.appendChild(row);

    if (prefill) {
        const select = row.querySelector('select');
        const inputs = row.querySelectorAll('input');
        select.value = prefill.expenseAccountId;
        inputs[0].value = prefill.amount.toLocaleString('en-US');
        inputs[1].value = prefill.narration || '';
    }

    recalcPettyCashTotal();
}

function removePettyCashLine(lineId) {
    document.querySelector(`.pc-line[data-line-id="${lineId}"]`)?.remove();
    recalcPettyCashTotal();
}

function getPettyCashLines() {
    return [...document.querySelectorAll('#pc-lines .pc-line')].map(row => {
        const select = row.querySelector('select');
        const inputs = row.querySelectorAll('input');
        const expenseAccountId = select.value;
        const account = expenseAccountId ? lfFindById(LF_KEYS.ACCOUNTS, expenseAccountId) : null;
        return {
            expenseAccountId, expenseAccountName: account ? account.title : '',
            amount: parseAmount(inputs[0].value), narration: sanitizeInput(inputs[1].value)
        };
    }).filter(l => l.expenseAccountId && l.amount > 0);
}

function recalcPettyCashTotal() {
    const total = getPettyCashLines().reduce((sum, l) => sum + l.amount, 0);
    $('pc-total').textContent = formatCurrency(total);
    return total;
}

async function savePettyCash() {
    if (!hasRight('VOUCHERS', 'Petty Cash', 'Edit')) {
        showToast("You don't have permission to save this.", 'warning');
        return;
    }
    const id = $('pc-id').value;
    const date = $('pc-date').value;
    const cashAccountId = $('pc-cash-account').value;
    const lines = getPettyCashLines();
    const saveBtn = $('pettycash-save-btn');

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!cashAccountId) { showToast('Please select which account this is paid from.', 'warning'); return; }
    if (lines.length === 0) { showToast('Add at least one expense line with an amount.', 'warning'); return; }

    const pcCancelled = !!$('pc-cancelled').checked;

    setBtnLoading(saveBtn, true);

    try {
        if (id) await removeLedgerEntriesForInvoice(id);

        const cashAcc = lfFindById(LF_KEYS.ACCOUNTS, cashAccountId);
        const voucherId = id || generateId();
        const number = id ? $('pc-number').value : await takeNextVoucherNumber('PettyCash');
        const total = lines.reduce((sum, l) => sum + l.amount, 0);

        if (!pcCancelled) {
            const writes = lines.map(line => lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: voucherId, accountId: line.expenseAccountId, date, type: 'PettyCash',
                ref: number, side: 'Dr', amount: line.amount, note: `Petty Cash ${number} — ${line.narration}`
            }));
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: voucherId, accountId: cashAccountId, date, type: 'PettyCash',
                ref: number, side: 'Cr', amount: total, note: `Petty Cash ${number}`
            }));
            await Promise.all(writes);
        }

        const before = id ? { ...(lfFindById(LF_KEYS.VOUCHERS, id) || {}) } : null;
        const record = {
            id: voucherId, type: 'PettyCash', number, date,
            cashAccountId, cashAccountName: cashAcc ? cashAcc.title : '',
            lines, total,
            cancelled: pcCancelled,
            createdAt: id ? undefined : new Date().toISOString(),
            enteredBy: id ? undefined : getCurrentUserDisplayName(),
            lastEditedBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.VOUCHERS, record);

        showToast(`Petty Cash voucher ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        logActivity(id ? 'Updated' : 'Created', 'Petty Cash', number,
                    { before, after: { ...record, enteredBy: before?.enteredBy || record.enteredBy }, recordId: voucherId });
        closePettyCashForm();
    } catch (e) {
        console.error('[Vouchers] Save failed:', e);
        showToast('Something went wrong while saving. Please try again.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

// ==================== JOURNAL VOUCHER ====================
function openJournalForm(editId = null) {
    if (!hasRight('VOUCHERS', 'Journal Voucher', 'Edit')) {
        showToast(`You don't have permission to ${editId ? 'edit' : 'add'} Journal Vouchers.`, 'warning');
        return;
    }
    if (editId) {
        const existing = lfFindById(LF_KEYS.VOUCHERS, editId);
        if (existing && checkLockbackOrWarn(existing.date, 'edit this voucher')) return;
    }
    const form = $('journal-form');
    form.reset();
    $('jv-id').value = '';
    $('jv-lines').innerHTML = '';
    jvLineCounter = 0;

    if (editId) {
        const v = lfFindById(LF_KEYS.VOUCHERS, editId);
        if (!v) { showToast('Voucher not found.', 'error'); return; }

        const note = $('jv-entered-by-note');
        if (v.enteredBy) {
            note.textContent = `Entered by ${v.enteredBy}` + (v.lastEditedBy && v.lastEditedBy !== v.enteredBy ? ` · last edited by ${v.lastEditedBy}` : '');
            note.classList.remove('hidden');
        } else {
            note.classList.add('hidden');
        }

        $('jv-id').value = v.id;
        $('jv-number').value = v.number;
        $('jv-date').value = v.date;
        $('jv-narration').value = v.narration || '';
        (v.lines || []).forEach(line => addJournalLine(line));
    } else {
        $('jv-number').value = peekNextVoucherNumber('Journal');
        $('jv-date').value = new Date().toISOString().slice(0, 10);
        $('jv-entered-by-note').classList.add('hidden');
        addJournalLine();
        addJournalLine();
    }

    recalcJournalTotals();

    const jvCancelRow = $('jv-cancel-row');
    const jvCancelCb = $('jv-cancelled');
    if (editId) {
        const v = lfFindById(LF_KEYS.VOUCHERS, editId);
        jvCancelRow.classList.remove('hidden');
        jvCancelCb.checked = !!(v && v.cancelled);
    } else {
        jvCancelRow.classList.add('hidden');
        jvCancelCb.checked = false;
    }

    $('journal-modal').classList.remove('hidden');
}

function closeJournalForm() {
    $('journal-modal').classList.add('hidden');
}

function addJournalLine(prefill = null) {
    jvLineCounter++;
    const lineId = `jvline${jvLineCounter}`;
    const container = $('jv-lines');

    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).sort((a, b) => a.title.localeCompare(b.title));
    const options = accounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join('');

    const row = document.createElement('div');
    row.className = 'jv-line';
    row.dataset.lineId = lineId;
    row.innerHTML = `
        <select onchange="recalcJournalTotals()"><option value="">Select account…</option>${options}</select>
        <input type="text" inputmode="decimal" placeholder="0" oninput="onJournalAmountInput(this,'dr')">
        <input type="text" inputmode="decimal" placeholder="0" oninput="onJournalAmountInput(this,'cr')">
        <button type="button" class="item-row-remove" title="Remove" onclick="removeJournalLine('${lineId}')">✕</button>
    `;
    container.appendChild(row);

    if (prefill) {
        const select = row.querySelector('select');
        const inputs = row.querySelectorAll('input');
        select.value = prefill.accountId;
        if (prefill.side === 'Dr') inputs[0].value = prefill.amount.toLocaleString('en-US');
        else inputs[1].value = prefill.amount.toLocaleString('en-US');
    }

    recalcJournalTotals();
}

// A line is either a Debit or a Credit, never both — typing in one clears the other
function onJournalAmountInput(input, side) {
    formatAmountInput(input);
    const row = input.closest('.jv-line');
    const inputs = row.querySelectorAll('input');
    if (side === 'dr' && input.value !== '') inputs[1].value = '';
    if (side === 'cr' && input.value !== '') inputs[0].value = '';
    recalcJournalTotals();
}

function removeJournalLine(lineId) {
    document.querySelector(`.jv-line[data-line-id="${lineId}"]`)?.remove();
    recalcJournalTotals();
}

function getJournalLines() {
    return [...document.querySelectorAll('#jv-lines .jv-line')].map(row => {
        const select = row.querySelector('select');
        const inputs = row.querySelectorAll('input');
        const accountId = select.value;
        const account = accountId ? lfFindById(LF_KEYS.ACCOUNTS, accountId) : null;
        const dr = parseAmount(inputs[0].value);
        const cr = parseAmount(inputs[1].value);
        const side = dr > 0 ? 'Dr' : (cr > 0 ? 'Cr' : null);
        const amount = dr > 0 ? dr : cr;
        return { accountId, accountName: account ? account.title : '', side, amount };
    }).filter(l => l.accountId && l.side && l.amount > 0);
}

function recalcJournalTotals() {
    const lines = getJournalLines();
    const totalDr = lines.filter(l => l.side === 'Dr').reduce((sum, l) => sum + l.amount, 0);
    const totalCr = lines.filter(l => l.side === 'Cr').reduce((sum, l) => sum + l.amount, 0);
    const diff = Math.round((totalDr - totalCr) * 100) / 100;

    $('jv-total-dr').textContent = formatCurrency(totalDr);
    $('jv-total-cr').textContent = formatCurrency(totalCr);
    $('jv-balance-label').textContent = diff === 0 ? 'Balanced' : 'Difference';
    $('jv-difference').textContent = formatCurrency(Math.abs(diff));

    return { totalDr, totalCr, diff };
}

async function saveJournal() {
    if (!hasRight('VOUCHERS', 'Journal Voucher', 'Edit')) {
        showToast("You don't have permission to save this.", 'warning');
        return;
    }
    const id = $('jv-id').value;
    const date = $('jv-date').value;
    const narration = sanitizeInput($('jv-narration').value);
    const lines = getJournalLines();
    const saveBtn = $('journal-save-btn');

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (lines.length < 2) { showToast('A journal voucher needs at least two lines.', 'warning'); return; }

    const { totalDr, totalCr, diff } = recalcJournalTotals();
    if (diff !== 0) {
        showToast(`Debits and credits don't match — off by ${formatCurrency(Math.abs(diff))}.`, 'error');
        return;
    }

    const jvCancelled = !!$('jv-cancelled').checked;

    setBtnLoading(saveBtn, true);

    try {
        if (id) await removeLedgerEntriesForInvoice(id);

        const voucherId = id || generateId();
        const number = id ? $('jv-number').value : await takeNextVoucherNumber('Journal');

        if (!jvCancelled) {
            await Promise.all(lines.map(line => lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: voucherId, accountId: line.accountId, date, type: 'Journal',
                ref: number, side: line.side, amount: line.amount, note: `Journal ${number} — ${narration}`
            })));
        }

        const before = id ? { ...(lfFindById(LF_KEYS.VOUCHERS, id) || {}) } : null;
        const record = {
            id: voucherId, type: 'Journal', number, date, narration,
            lines, totalDr, totalCr,
            cancelled: jvCancelled,
            createdAt: id ? undefined : new Date().toISOString(),
            enteredBy: id ? undefined : getCurrentUserDisplayName(),
            lastEditedBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.VOUCHERS, record);

        showToast(`Journal Voucher ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        logActivity(id ? 'Updated' : 'Created', 'Journal Voucher', number,
                    { before, after: { ...record, enteredBy: before?.enteredBy || record.enteredBy }, recordId: voucherId });
        closeJournalForm();
    } catch (e) {
        console.error('[Vouchers] Save failed:', e);
        showToast('Something went wrong while saving. Please try again.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    ['BankReceipt', 'BankPayment', 'PettyCash', 'Journal'].forEach(type => renderVoucherList(type));
});
