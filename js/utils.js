/**
 * LedgerFlow - Shared utility helpers used across every module.
 */

// Shortcut for document.getElementById
function $(id) { return document.getElementById(id); }

// Whether a given .page section is the one currently on screen — used to
// skip expensive report recomputation triggered by a live Firestore
// listener when nobody's actually looking at that report right now. Safe
// to use as an early-return guard: whenever a page is genuinely opened
// (navigateTo + the report's own filter/submit flow), that happens after
// the page is already marked active, so a real render is never skipped.
function isPageActive(pageId) {
    const el = $(pageId);
    return !!el && el.classList.contains('is-active');
}

// ==================== ID GENERATION ====================
function generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `${prefix}${timestamp}${random}`.toUpperCase();
}

// ==================== TOASTS ====================
function showToast(message, type = 'info', duration = 3200) {
    const stack = $('toast-stack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = `toast is-${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// ==================== VALIDATION ====================
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email);
}

function validateEmailField(input) {
    const tick = input.parentElement.querySelector('.email-tick');
    if (!tick) return;
    const val = input.value.trim();
    if (!val) { tick.className = 'email-tick'; return; }
    tick.className = 'email-tick ' + (isValidEmail(val) ? 'is-valid' : 'is-invalid');
}

// Pakistani mobile: 10 digits after +92, must start with 3 (e.g. 3332392852)
function isValidPakMobile(digits) {
    return /^3\d{9}$/.test(digits);
}

function sanitizeInput(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/[<>]/g, '').trim();
}

// ==================== NUMBER / CURRENCY ====================
function formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    const label = (typeof lfGetSettings === 'function') ? lfGetSettings().currencyLabel : 'Rs.';
    return `${label} ` + num.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseAmount(value) {
    return parseFloat(String(value).replace(/,/g, '')) || 0;
}

/**
 * Format a plain-number input as the user types (adds thousands separators).
 * Used for Rs. amount fields.
 */
function formatAmountInput(input) {
    const raw = input.value.replace(/[^\d.]/g, '');
    const parts = raw.split('.');
    let whole = parts[0].replace(/^0+(?=\d)/, '');
    if (whole) whole = parseInt(whole, 10).toLocaleString('en-US');
    input.value = parts.length > 1 ? `${whole}.${parts[1].slice(0, 2)}` : whole;
}

/**
 * Format the mobile/phone input as the user types: groups digits as
 * "333 2392852" so it visually matches the +92 prefix chip beside it.
 */
function formatPhoneInput(input) {
    let digits = input.value.replace(/\D/g, '').slice(0, 10);
    if (digits.length > 3) {
        input.value = digits.slice(0, 3) + ' ' + digits.slice(3);
    } else {
        input.value = digits;
    }
}

function getDigitsOnly(value) {
    return (value || '').replace(/\D/g, '');
}

// ==================== DEBOUNCE ====================
function debounce(fn, wait = 200) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

// ==================== CURRENT USER DISPLAY NAME ====================
// Used to record who entered/edited each transaction (Invoices, Vouchers).
function getCurrentUserDisplayName() {
    const authUser = (typeof fbAuth !== 'undefined') ? fbAuth.currentUser : null;
    if (!authUser) return 'Unknown';
    const match = lfGetAll(LF_KEYS.USERS).find(u => u.linkedAuthUid === authUser.uid);
    return match ? match.fullName : (authUser.email || 'Unknown');
}

// ==================== EDIT HISTORY ====================
// Every create/update/delete is recorded with a field-level before/after
// diff, so "what actually changed on this voucher, and who changed it"
// is answerable months later.

// Bookkeeping fields nobody wants to see in a change list — they either
// change on every single save, or they're internal plumbing.
const HISTORY_IGNORED_FIELDS = new Set([
    'id', 'createdAt', 'updatedAt', 'enteredBy', 'lastEditedBy', 'linkedAuthUid'
]);

// Raw record keys are developer names; these are what a person should read.
const HISTORY_FIELD_LABELS = {
    title: 'Title', name: 'Name', type: 'Type', mobile: 'Mobile', phone: 'Phone',
    email: 'Email', city: 'City', gst: 'GST No.', ntn: 'NTN No.', address: 'Address',
    openingAmount: 'Opening Balance', openingSide: 'Opening Dr/Cr',
    category: 'Category', unit: 'Unit', purchasePrice: 'Purchase Price',
    salePrice: 'Sale Price', tax: 'Tax', openingQty: 'Opening Qty',
    fullName: 'Full Name', username: 'Email', status: 'Status', role: 'Role',
    number: 'Number', date: 'Date', refNumber: 'Ref No.', refDate: 'Ref Date',
    partyAccountId: 'Party', partyName: 'Party', debitTo: 'Debit To',
    hasLoad: 'Includes Load', loadAmount: 'Load Amount', loadDiscount: 'Load Discount %',
    loadQty: 'Load Qty', itemsTotal: 'Items Total', loadTotal: 'Load Total',
    grandTotal: 'Grand Total', paymentMode: 'Payment Mode',
    paymentAccountId: 'Payment Account', paymentAmount: 'Paid Amount',
    balanceAmount: 'Balance', items: 'Item Lines', lines: 'Lines',
    bankAccountId: 'Bank/Cash Account', bankName: 'Bank/Cash Account',
    amount: 'Amount', chequeNo: 'Cheque No.', chequeDate: 'Cheque Date',
    narration: 'Narration', cashAccountId: 'Cash Account',
    cashAccountName: 'Cash Account', total: 'Total',
    totalDr: 'Total Debit', totalCr: 'Total Credit'
};

const HISTORY_MONEY_FIELDS = new Set([
    'openingAmount', 'purchasePrice', 'salePrice', 'loadAmount', 'itemsTotal',
    'loadTotal', 'grandTotal', 'paymentAmount', 'balanceAmount', 'amount',
    'total', 'totalDr', 'totalCr'
]);

function historyFieldLabel(key) {
    if (HISTORY_FIELD_LABELS[key]) return HISTORY_FIELD_LABELS[key];
    // Fall back to turning camelCase into words rather than showing a raw key
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

// Renders a stored value the way the person saw it in the form.
function historyFormatValue(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
        if (value.length === 0) return 'none';
        return `${value.length} row${value.length === 1 ? '' : 's'}`;
    }
    if (typeof value === 'object') return JSON.stringify(value);
    if (HISTORY_MONEY_FIELDS.has(key) && typeof value === 'number') {
        return (typeof formatCurrency === 'function') ? formatCurrency(value) : String(value);
    }
    return String(value);
}

// Compares two versions of a record and returns only what actually moved.
// Arrays (invoice item rows, voucher lines) are compared as a whole via
// JSON — enough to say "these lines changed" without pretending to do a
// meaningful row-by-row diff of free-form data.
function diffRecords(before, after) {
    const changes = [];
    const a = before || {};
    const b = after || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

    keys.forEach(key => {
        if (HISTORY_IGNORED_FIELDS.has(key)) return;
        const from = a[key];
        const to = b[key];
        if (to === undefined && from === undefined) return;

        const same = (typeof from === 'object' || typeof to === 'object')
            ? JSON.stringify(from ?? null) === JSON.stringify(to ?? null)
            : String(from ?? '') === String(to ?? '');
        if (same) return;

        changes.push({
            field: key,
            label: historyFieldLabel(key),
            from: historyFormatValue(key, from),
            to: historyFormatValue(key, to)
        });
    });

    return changes.sort((x, y) => x.label.localeCompare(y.label));
}

// Fire-and-forget on purpose — logging a failure should never block or
// break the actual save/delete the person is trying to do.
//
// opts: { before, after, recordId } — pass the record as it was and as it
// now is, and the entry carries a full field-level diff.
function logActivity(action, entityType, label, opts = {}) {
    try {
        const user = (typeof fbAuth !== 'undefined' && fbAuth.currentUser) ? fbAuth.currentUser : null;
        const entry = {
            action, entityType, label: label || '',
            userEmail: user ? user.email : 'unknown',
            userName: (typeof getCurrentUserDisplayName === 'function') ? getCurrentUserDisplayName() : '',
            timestamp: new Date().toISOString()
        };

        if (opts.recordId) entry.recordId = opts.recordId;

        if (action === 'Updated' && opts.before && opts.after) {
            entry.changes = diffRecords(opts.before, opts.after);
        } else if (action === 'Created' && opts.after) {
            // A creation has no "before", so record the values it started
            // with — that's what makes the trail auditable end to end.
            entry.changes = diffRecords({}, opts.after);
        } else if (action === 'Deleted' && opts.before) {
            entry.changes = diffRecords(opts.before, {});
        }

        // Who originally created the record, carried onto every later entry
        // so the history can show creator and editor side by side.
        const src = opts.after || opts.before;
        if (src && src.enteredBy) entry.createdBy = src.enteredBy;

        lfUpsert(LF_KEYS.EDIT_LOG, entry)
            .catch(err => console.error('[EditHistory] Failed to log:', err));
    } catch (err) {
        console.error('[EditHistory] Failed to log:', err);
    }
}

// ==================== ESCAPE HTML ====================
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getDateFilter(fromId, toId) {
    const from = $(fromId)?.value || '';
    const to = $(toId)?.value || '';
    return { from, to };
}

function applyDateFilter(list, fromId, toId) {
    const { from, to } = getDateFilter(fromId, toId);
    if (from) list = list.filter(r => r.date >= from);
    if (to) list = list.filter(r => r.date <= to);
    return list;
}

function matchesDocNumber(docNumber, term) {
    if (!docNumber || !term) return false;
    const num = docNumber.toLowerCase();
    if (num.includes(term)) return true;
    const numericPart = num.replace(/^[a-z]+-0*/i, '');
    const termDigits = term.replace(/^0+/, '');
    if (termDigits && numericPart === termDigits) return true;
    if (termDigits && numericPart.startsWith(termDigits)) return true;
    return false;
}

function matchesAmount(amount, term) {
    if (!term || isNaN(amount)) return false;
    const clean = term.replace(/,/g, '');
    if (!/^\d+\.?\d*$/.test(clean)) return false;
    return String(Math.round(amount)) === String(Math.round(parseFloat(clean)));
}

function acctLabel(a) {
    const shortType = a.type === 'Employee/RSO' ? 'RSO' : a.type;
    if (a.title.toLowerCase().includes(shortType.toLowerCase())) return a.title;
    return `${a.title} (${shortType})`;
}
