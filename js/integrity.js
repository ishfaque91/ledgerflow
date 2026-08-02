/**
 * LedgerFlow - Accounting Integrity & Performance utilities
 *
 * 1. Lockback enforcement — prevents editing/deleting transactions
 *    older than the configured lockbackDays for the current user.
 * 2. Balance cache — memoizes computeAccountBalance per render cycle
 *    so reports that call it for every account don't re-scan the
 *    entire ledger N times.
 * 3. Integrity checker — admin-facing scan that flags orphaned ledger
 *    entries, unlinked accounts, and Dr/Cr imbalances.
 */

// ==================== LOCKBACK ENFORCEMENT ====================
function getLockbackDate() {
    if (isCurrentUserOwner()) return null;
    const user = getCurrentUserRecord();
    const record = lfGetAll(LF_KEYS.RIGHTS).find(r => r.userId === user.id);
    const days = record?.lockbackDays;
    if (!days || days <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function isDateLocked(dateStr) {
    const cutoff = getLockbackDate();
    if (!cutoff) return false;
    return dateStr < cutoff;
}

function checkLockbackOrWarn(dateStr, action) {
    if (!isDateLocked(dateStr)) return false;
    const days = lfGetAll(LF_KEYS.RIGHTS).find(r => r.userId === getCurrentUserRecord()?.id)?.lockbackDays || 0;
    showToast(`Cannot ${action} — this entry is older than your ${days}-day edit window.`, 'warning', 5000);
    return true;
}

// ==================== BALANCE CACHE ====================
let _balanceCache = null;
let _balanceCacheKey = 0;

function invalidateBalanceCache() {
    _balanceCacheKey++;
    _balanceCache = null;
}

function getCachedAccountBalance(accountId) {
    if (!_balanceCache) _balanceCache = {};
    if (_balanceCache._key === _balanceCacheKey && _balanceCache[accountId]) {
        return _balanceCache[accountId];
    }
    _balanceCache._key = _balanceCacheKey;
    const result = computeAccountBalance(accountId);
    _balanceCache[accountId] = result;
    return result;
}

function buildBalanceCacheAsOf(asOfDate) {
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS);
    const cancelledIds = getCancelledDocIds();
    const entries = lfGetAll(LF_KEYS.ACCOUNT_LEDGER);

    const byAccount = {};
    entries.forEach(e => {
        if (cancelledIds.has(e.invoiceId)) return;
        if (asOfDate && e.date > asOfDate) return;
        if (!byAccount[e.accountId]) byAccount[e.accountId] = [];
        byAccount[e.accountId].push(e);
    });

    const results = {};
    accounts.forEach(acc => {
        let net = (acc.openingSide === 'Cr' ? -1 : 1) * (acc.openingAmount || 0);
        (byAccount[acc.id] || []).forEach(e => {
            net += (e.side === 'Cr' ? -1 : 1) * e.amount;
        });
        results[acc.id] = { amount: Math.abs(net), side: net >= 0 ? 'Dr' : 'Cr' };
    });
    return results;
}

// ==================== INTEGRITY CHECKER ====================
function runIntegrityCheck() {
    const results = [];
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS);
    const ledger = lfGetAll(LF_KEYS.ACCOUNT_LEDGER);
    const invoices = lfGetAll(LF_KEYS.INVOICES);
    const vouchers = lfGetAll(LF_KEYS.VOUCHERS);
    const accountIds = new Set(accounts.map(a => a.id));

    let totalDr = 0, totalCr = 0;
    const orphanedEntries = [];
    const invoiceIds = new Set([
        ...invoices.map(i => i.id),
        ...vouchers.map(v => v.id),
        ...lfGetAll(LF_KEYS.RSO_LOADS).map(l => l.id),
        ...lfGetAll(LF_KEYS.RSO_SALES).map(s => s.id),
        ...lfGetAll(LF_KEYS.RSO_RETURNS).map(r => r.id),
        ...lfGetAll(LF_KEYS.RSO_DEPOSITS).map(d => d.id)
    ]);

    ledger.forEach(e => {
        if (e.side === 'Dr') totalDr += e.amount;
        else totalCr += e.amount;

        if (!accountIds.has(e.accountId)) {
            orphanedEntries.push({ type: 'orphan-account', entry: e,
                msg: `Ledger entry "${e.ref}" references deleted account ${e.accountId}` });
        }

        if (e.invoiceId && !invoiceIds.has(e.invoiceId)) {
            orphanedEntries.push({ type: 'orphan-invoice', entry: e,
                msg: `Ledger entry "${e.ref}" references missing document ${e.invoiceId}` });
        }
    });

    const openingDr = accounts.reduce((s, a) =>
        s + (a.openingSide !== 'Cr' ? (a.openingAmount || 0) : 0), 0);
    const openingCr = accounts.reduce((s, a) =>
        s + (a.openingSide === 'Cr' ? (a.openingAmount || 0) : 0), 0);

    results.push({
        label: 'Ledger Dr/Cr Totals',
        status: Math.abs(totalDr - totalCr) < 0.01 ? 'ok' : 'warn',
        detail: `Dr: ${formatCurrency(totalDr)} | Cr: ${formatCurrency(totalCr)} | Diff: ${formatCurrency(Math.abs(totalDr - totalCr))}`
    });

    results.push({
        label: 'Opening Balance Totals',
        status: Math.abs(openingDr - openingCr) < 0.01 ? 'ok' : 'warn',
        detail: `Dr: ${formatCurrency(openingDr)} | Cr: ${formatCurrency(openingCr)} | Diff: ${formatCurrency(Math.abs(openingDr - openingCr))}`
    });

    results.push({
        label: 'Orphaned Ledger Entries',
        status: orphanedEntries.length === 0 ? 'ok' : 'error',
        detail: orphanedEntries.length === 0
            ? 'All ledger entries reference valid accounts and documents.'
            : `${orphanedEntries.length} orphaned entr${orphanedEntries.length === 1 ? 'y' : 'ies'} found.`,
        items: orphanedEntries.map(o => o.msg)
    });

    const jvVouchers = vouchers.filter(v => v.type === 'Journal');
    let unbalancedJvs = 0;
    jvVouchers.forEach(v => {
        const dr = (v.lines || []).filter(l => l.side === 'Dr').reduce((s, l) => s + l.amount, 0);
        const cr = (v.lines || []).filter(l => l.side === 'Cr').reduce((s, l) => s + l.amount, 0);
        if (Math.abs(dr - cr) > 0.01) unbalancedJvs++;
    });

    results.push({
        label: 'Journal Voucher Balance',
        status: unbalancedJvs === 0 ? 'ok' : 'error',
        detail: unbalancedJvs === 0
            ? `All ${jvVouchers.length} journal vouchers are balanced.`
            : `${unbalancedJvs} unbalanced journal voucher(s) found.`
    });

    return results;
}

function renderIntegrityCheck() {
    const container = $('integrity-results');
    if (!container) return;

    const results = runIntegrityCheck();
    const icons = { ok: '✔', warn: '⚠', error: '✖' };

    container.innerHTML = results.map(r => `
        <div class="integrity-row integrity-${r.status}">
            <span class="integrity-icon">${icons[r.status]}</span>
            <div class="integrity-content">
                <strong>${escapeHtml(r.label)}</strong>
                <p>${escapeHtml(r.detail)}</p>
                ${(r.items || []).length > 0 ? `<ul>${r.items.slice(0, 10).map(i => `<li>${escapeHtml(i)}</li>`).join('')}${r.items.length > 10 ? `<li>...and ${r.items.length - 10} more</li>` : ''}</ul>` : ''}
            </div>
        </div>
    `).join('');
}
