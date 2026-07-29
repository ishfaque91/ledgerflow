/**
 * LedgerFlow - Shared utility helpers used across every module.
 */

// Shortcut for document.getElementById
function $(id) { return document.getElementById(id); }

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
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

// ==================== ACTIVITY LOG ====================
// Fire-and-forget on purpose — logging a failure should never block or
// break the actual save/delete the person is trying to do.
function logActivity(action, entityType, label) {
    try {
        const user = (typeof fbAuth !== 'undefined' && fbAuth.currentUser) ? fbAuth.currentUser : null;
        lfUpsert(LF_KEYS.EDIT_LOG, {
            action, entityType, label: label || '',
            userEmail: user ? user.email : 'unknown',
            timestamp: new Date().toISOString()
        }).catch(err => console.error('[EditLog] Failed to log:', err));
    } catch (err) {
        console.error('[EditLog] Failed to log:', err);
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
