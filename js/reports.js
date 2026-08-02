/**
 * LedgerFlow - Reports module, Phase 1 (the ledgers and registers).
 * Everything here reads from data already posted by Management, Data
 * Entry, and Vouchers — nothing in this file writes any data.
 */

// ==================== SHARED HELPERS ====================

// Converts a signed running total (+ = Dr, - = Cr) into a display pair
function signedToDisplay(signed) {
    return { amount: Math.abs(signed), side: signed >= 0 ? 'Dr' : 'Cr' };
}

function repopulateSelect(select, optionsHtml) {
    const previous = select.value;
    select.innerHTML = optionsHtml;
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
}

function balanceHtml(amount, side) {
    const cls = side === 'Cr' ? 'is-cr' : 'is-dr';
    return `<span class="balance-tag ${cls}">${formatCurrency(amount)} ${side}</span>`;
}

// ==================== CHART OF ACCOUNTS ====================
function initChartOfAccountsPage() {
    const filter = $('coa-type-filter');
    repopulateSelect(filter, '<option value="">All types</option>' +
        ACCOUNT_TYPES.map(t => `<option value="${t}">${t}</option>`).join(''));
    renderChartOfAccounts();
}

function renderChartOfAccounts() {
    updateReportHeader('page-chart-of-accounts');
    const term = ($('coa-search')?.value || '').trim().toLowerCase();
    const typeFilter = $('coa-type-filter')?.value || '';

    let accounts = lfGetAll(LF_KEYS.ACCOUNTS);
    if (typeFilter) accounts = accounts.filter(a => a.type === typeFilter);
    if (term) accounts = accounts.filter(a => (a.title || '').toLowerCase().includes(term));

    accounts.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
    $('coa-count').textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;

    const tbody = $('coa-table-body');
    if (accounts.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No matching accounts.</td></tr>`;
        return;
    }

    invalidateBalanceCache();
    tbody.innerHTML = accounts.map(a => {
        const bal = getCachedAccountBalance(a.id);
        return `
        <tr>
            <td><span class="type-badge">${escapeHtml(a.type)}</span></td>
            <td><strong>${escapeHtml(a.title)}</strong></td>
            <td>${a.mobile ? '+92 ' + escapeHtml(a.mobile) : '-'}</td>
            <td>${escapeHtml(a.city) || '-'}</td>
            <td class="num">${balanceHtml(bal.amount, bal.side)}</td>
        </tr>`;
    }).join('');
}

// ==================== ACCOUNT LEDGER (also powers Cash Book) ====================
function computeAccountLedgerRows(accountId, dateFrom, dateTo) {
    const acc = lfFindById(LF_KEYS.ACCOUNTS, accountId);
    if (!acc) return null;

    const cancelledIds = getCancelledDocIds();
    const entries = lfGetAll(LF_KEYS.ACCOUNT_LEDGER)
        .filter(e => e.accountId === accountId && !cancelledIds.has(e.invoiceId))
        .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.invoiceId || '').localeCompare(b.invoiceId || ''));

    let openingSigned = (acc.openingSide === 'Cr' ? -1 : 1) * (acc.openingAmount || 0);
    const within = [];

    entries.forEach(e => {
        const signedAmount = (e.side === 'Cr' ? -1 : 1) * e.amount;
        if (dateFrom && e.date < dateFrom) { openingSigned += signedAmount; return; }
        if (dateTo && e.date > dateTo) return;
        within.push(e);
    });

    let running = openingSigned;
    const rows = within.map(e => {
        running += (e.side === 'Cr' ? -1 : 1) * e.amount;
        return { ...e, runningSigned: running };
    });

    return {
        opening: signedToDisplay(openingSigned),
        closing: signedToDisplay(rows.length ? rows[rows.length - 1].runningSigned : openingSigned),
        rows
    };
}

function renderLedgerRowsIntoTable(rows, tbodyId, colCount) {
    const tbody = $(tbodyId);
    if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${colCount}">No entries in this range.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(e => {
        const bal = signedToDisplay(e.runningSigned);
        return `
        <tr>
            <td>${escapeHtml(e.date)}</td>
            <td><span class="type-badge">${escapeHtml(e.type)}</span></td>
            <td>${escapeHtml(e.ref)}</td>
            <td>${escapeHtml(e.note) || '-'}</td>
            <td class="num">${e.side === 'Dr' ? formatCurrency(e.amount) : '-'}</td>
            <td class="num">${e.side === 'Cr' ? formatCurrency(e.amount) : '-'}</td>
            <td class="num">${balanceHtml(bal.amount, bal.side)}</td>
        </tr>`;
    }).join('');
}

function initAccountLedgerPage(preselectAccountId) {
    const select = $('al-account');
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).sort((a, b) => a.title.localeCompare(b.title));
    repopulateSelect(select, accounts.map(a => `<option value="${a.id}">${escapeHtml(acctLabel(a))}</option>`).join(''));
    if (preselectAccountId) select.value = preselectAccountId;
    renderAccountLedgerReport();
}

function renderAccountLedgerReport() {
    updateReportHeader('page-account-ledger');
    const accountId = $('al-account').value;
    const dateFrom = $('al-date-from').value;
    const dateTo = $('al-date-to').value;
    if (!accountId) {
        $('account-ledger-table-body').innerHTML = `<tr class="empty-row"><td colspan="7">Add an account first under Management.</td></tr>`;
        return;
    }
    const result = computeAccountLedgerRows(accountId, dateFrom, dateTo);
    if (!result) {
        $('account-ledger-table-body').innerHTML = `<tr class="empty-row"><td colspan="7">Could not find that account — try selecting it again.</td></tr>`;
        return;
    }
    $('al-opening').textContent = `${formatCurrency(result.opening.amount)} ${result.opening.side}`;
    $('al-opening').className = `report-summary-value ${result.opening.side === 'Cr' ? 'is-cr' : 'is-dr'}`;
    $('al-closing').textContent = `${formatCurrency(result.closing.amount)} ${result.closing.side}`;
    $('al-closing').className = `report-summary-value ${result.closing.side === 'Cr' ? 'is-cr' : 'is-dr'}`;
    renderLedgerRowsIntoTable(result.rows, 'account-ledger-table-body', 7);
}

// ==================== CASH BOOK (Account Ledger, restricted to Cash/Bank accounts) ====================
function initCashBookPage() {
    const select = $('cb-account');
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Cash' || a.type === 'Bank').sort((a, b) => a.title.localeCompare(b.title));
    repopulateSelect(select, accounts.map(a => `<option value="${a.id}">${escapeHtml(acctLabel(a))}</option>`).join(''));
    renderCashBookReport();
}

function renderCashBookReport() {
    updateReportHeader('page-cash-book');
    const accountId = $('cb-account').value;
    const dateFrom = $('cb-date-from').value;
    const dateTo = $('cb-date-to').value;
    if (!accountId) {
        $('cash-book-table-body').innerHTML = `<tr class="empty-row"><td colspan="7">Add a Cash or Bank account first under Management.</td></tr>`;
        return;
    }
    const result = computeAccountLedgerRows(accountId, dateFrom, dateTo);
    if (!result) {
        $('cash-book-table-body').innerHTML = `<tr class="empty-row"><td colspan="7">Could not find that account — try selecting it again.</td></tr>`;
        return;
    }
    $('cb-opening').textContent = `${formatCurrency(result.opening.amount)} ${result.opening.side}`;
    $('cb-opening').className = `report-summary-value ${result.opening.side === 'Cr' ? 'is-cr' : 'is-dr'}`;
    $('cb-closing').textContent = `${formatCurrency(result.closing.amount)} ${result.closing.side}`;
    $('cb-closing').className = `report-summary-value ${result.closing.side === 'Cr' ? 'is-cr' : 'is-dr'}`;
    renderLedgerRowsIntoTable(result.rows, 'cash-book-table-body', 7);
}

// ==================== LOAD LEDGER ====================
function computeLoadLedgerRows(dateFrom, dateTo) {
    const cancelledIds = getCancelledDocIds();
    const entries = lfGetAll(LF_KEYS.LOAD_LEDGER).filter(e => !cancelledIds.has(e.invoiceId)).sort((a, b) => new Date(a.date) - new Date(b.date));
    let opening = 0, openingAmt = 0;
    const within = [];

    entries.forEach(e => {
        if (dateFrom && e.date < dateFrom) { opening += e.qtyChange; openingAmt += (e.amountChange || 0); return; }
        if (dateTo && e.date > dateTo) return;
        within.push(e);
    });

    let running = opening, runningAmt = openingAmt;
    const rows = within.map(e => {
        running += e.qtyChange;
        runningAmt += (e.amountChange || 0);
        return { ...e, runningBalance: running, runningAmount: runningAmt };
    });

    return { opening, openingAmt, closing: rows.length ? rows[rows.length - 1].runningBalance : opening, closingAmt: rows.length ? rows[rows.length - 1].runningAmount : openingAmt, rows };
}

function initLoadLedgerPage() { renderLoadLedgerReport(); }

function renderLoadLedgerReport() {
    updateReportHeader('page-load-ledger');
    const dateFrom = $('ll-date-from').value;
    const dateTo = $('ll-date-to').value;
    const result = computeLoadLedgerRows(dateFrom, dateTo);

    $('ll-opening').textContent = result.opening.toLocaleString('en-US');
    $('ll-closing').textContent = result.closing.toLocaleString('en-US');

    const tbody = $('load-ledger-table-body');
    if (result.rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No load movement in this range.</td></tr>`;
        return;
    }
    tbody.innerHTML = result.rows.map(e => `
        <tr>
            <td>${escapeHtml(e.date)}</td>
            <td><span class="type-badge">${escapeHtml(e.type)}</span></td>
            <td>${escapeHtml(e.ref)}</td>
            <td>${escapeHtml(e.note) || '-'}</td>
            <td class="num">${e.qtyChange > 0 ? e.qtyChange.toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.qtyChange < 0 ? Math.abs(e.qtyChange).toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.runningBalance.toLocaleString('en-US')}</td>
            <td class="num">${formatCurrency(Math.abs(e.amountChange || 0))}</td>
        </tr>
    `).join('');
}

// ==================== ITEM LEDGER ====================
function computeItemLedgerRows(itemId, dateFrom, dateTo) {
    const cancelledIds = getCancelledDocIds();
    const entries = lfGetAll(LF_KEYS.ITEM_LEDGER).filter(e => e.itemId === itemId && !cancelledIds.has(e.invoiceId)).sort((a, b) => new Date(a.date) - new Date(b.date));
    let opening = 0;
    const within = [];

    entries.forEach(e => {
        if (dateFrom && e.date < dateFrom) { opening += e.qtyChange; return; }
        if (dateTo && e.date > dateTo) return;
        within.push(e);
    });

    let running = opening;
    const rows = within.map(e => {
        running += e.qtyChange;
        return { ...e, runningBalance: running };
    });

    return { opening, closing: rows.length ? rows[rows.length - 1].runningBalance : opening, rows };
}

function computeItemCurrentStock(itemId) {
    const cancelledIds = getCancelledDocIds();
    return lfGetAll(LF_KEYS.ITEM_LEDGER).filter(e => e.itemId === itemId && !cancelledIds.has(e.invoiceId)).reduce((sum, e) => sum + e.qtyChange, 0);
}

function initItemLedgerPage(preselectItemId) {
    const select = $('il-item');
    const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));
    repopulateSelect(select, items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join(''));
    if (preselectItemId) select.value = preselectItemId;
    renderItemLedgerReport();
}

function renderItemLedgerReport() {
    updateReportHeader('page-item-ledger');
    const itemId = $('il-item').value;
    const dateFrom = $('il-date-from').value;
    const dateTo = $('il-date-to').value;
    if (!itemId) {
        $('item-ledger-table-body').innerHTML = `<tr class="empty-row"><td colspan="6">Add an item first under Management.</td></tr>`;
        return;
    }
    const result = computeItemLedgerRows(itemId, dateFrom, dateTo);
    $('il-opening').textContent = result.opening.toLocaleString('en-US');
    $('il-closing').textContent = result.closing.toLocaleString('en-US');

    const tbody = $('item-ledger-table-body');
    if (result.rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No stock movement in this range.</td></tr>`;
        return;
    }
    tbody.innerHTML = result.rows.map(e => `
        <tr>
            <td>${escapeHtml(e.date)}</td>
            <td><span class="type-badge">${escapeHtml(e.type)}</span></td>
            <td>${escapeHtml(e.ref)}</td>
            <td class="num">${e.qtyChange > 0 ? e.qtyChange.toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.qtyChange < 0 ? Math.abs(e.qtyChange).toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.runningBalance.toLocaleString('en-US')}</td>
        </tr>
    `).join('');
}

// ==================== STOCK REPORT ====================
// A per-item version of the same Opening / In / Out / Closing shape the
// Account Ledger and Item Ledger already use, rather than a bare "current
// stock" figure with no way to see movement over a chosen window.
function computeItemStockSummary(itemId, dateFrom, dateTo) {
    const cancelledIds = getCancelledDocIds();
    const entries = lfGetAll(LF_KEYS.ITEM_LEDGER)
        .filter(e => e.itemId === itemId && !cancelledIds.has(e.invoiceId))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    let opening = 0, qtyIn = 0, qtyOut = 0;
    entries.forEach(e => {
        if (dateFrom && e.date < dateFrom) { opening += e.qtyChange; return; }
        if (dateTo && e.date > dateTo) return;
        if (e.qtyChange >= 0) qtyIn += e.qtyChange; else qtyOut += Math.abs(e.qtyChange);
    });

    return { opening, in: qtyIn, out: qtyOut, closing: opening + qtyIn - qtyOut };
}

function initStockReportPage() { renderStockReport(); }

function renderStockReport() {
    if (!isPageActive('page-stock-report')) return;
    updateReportHeader('page-stock-report');

    // Defaults to the whole life of the company (same rule the graph
    // reports use) whenever the fields are blank — not just on first open,
    // but on every render, so resuming here after a refresh (which skips
    // the filter modal that normally sets these) still shows real dates
    // instead of empty inputs.
    if ($('stock-date-from') && !$('stock-date-from').value) {
        $('stock-date-from').value = getCompanyDoc().signupDate || new Date().toISOString().slice(0, 10);
    }
    if ($('stock-date-to') && !$('stock-date-to').value) {
        $('stock-date-to').value = new Date().toISOString().slice(0, 10);
    }

    const term = ($('stock-search')?.value || '').trim().toLowerCase();
    const dateFrom = $('stock-date-from')?.value || '';
    const dateTo = $('stock-date-to')?.value || '';

    let items = lfGetAll(LF_KEYS.ITEMS);
    if (term) items = items.filter(i => (i.name || '').toLowerCase().includes(term));
    items.sort((a, b) => a.name.localeCompare(b.name));

    $('stock-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    const tbody = $('stock-report-table-body');
    if (items.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No items yet.</td></tr>`;
        return;
    }

    // Pre-index item ledger by itemId so each item doesn't rescan the full list
    const cancelledIds = getCancelledDocIds();
    const itemLedgerByItem = {};
    lfGetAll(LF_KEYS.ITEM_LEDGER).filter(e => !cancelledIds.has(e.invoiceId)).forEach(e => {
        if (!itemLedgerByItem[e.itemId]) itemLedgerByItem[e.itemId] = [];
        itemLedgerByItem[e.itemId].push(e);
    });

    const loadEntries = lfGetAll(LF_KEYS.LOAD_LEDGER).filter(e => !cancelledIds.has(e.invoiceId));
    let loadOpening = 0, loadIn = 0, loadOut = 0;
    let loadAmtOpening = 0, loadAmtIn = 0, loadAmtOut = 0;
    loadEntries.sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
        if (dateFrom && e.date < dateFrom) {
            loadOpening += e.qtyChange;
            loadAmtOpening += (e.amountChange || 0);
            return;
        }
        if (dateTo && e.date > dateTo) return;
        if (e.qtyChange >= 0) { loadIn += e.qtyChange; loadAmtIn += (e.amountChange || 0); }
        else { loadOut += Math.abs(e.qtyChange); loadAmtOut += Math.abs(e.amountChange || 0); }
    });
    const loadClosingQty = loadOpening + loadIn - loadOut;
    const loadClosingAmt = loadAmtOpening + loadAmtIn - loadAmtOut;

    const loadRow = `
        <tr style="background:rgba(var(--accent-rgb, 99,102,241), 0.06);">
            <td><strong>Load (Balance)</strong></td>
            <td>Load</td>
            <td class="num">${loadOpening.toLocaleString('en-US')}</td>
            <td class="num">${loadIn ? loadIn.toLocaleString('en-US') : '-'}</td>
            <td class="num">${loadOut ? loadOut.toLocaleString('en-US') : '-'}</td>
            <td class="num"><strong>${loadClosingQty.toLocaleString('en-US')}</strong></td>
            <td class="num">${formatCurrency(Math.max(0, loadClosingAmt))}</td>
        </tr>`;

    tbody.innerHTML = loadRow + items.map(i => {
        const entries = itemLedgerByItem[i.id] || [];
        let opening = 0, qtyIn = 0, qtyOut = 0;
        entries.forEach(e => {
            if (dateFrom && e.date < dateFrom) { opening += e.qtyChange; return; }
            if (dateTo && e.date > dateTo) return;
            if (e.qtyChange >= 0) qtyIn += e.qtyChange; else qtyOut += Math.abs(e.qtyChange);
        });
        const s = { opening, in: qtyIn, out: qtyOut, closing: opening + qtyIn - qtyOut };
        return `
        <tr>
            <td><strong>${escapeHtml(i.name)}</strong></td>
            <td>${escapeHtml(i.category) || '-'}</td>
            <td class="num">${s.opening.toLocaleString('en-US')}</td>
            <td class="num">${s.in ? s.in.toLocaleString('en-US') : '-'}</td>
            <td class="num">${s.out ? s.out.toLocaleString('en-US') : '-'}</td>
            <td class="num"><strong>${s.closing.toLocaleString('en-US')}</strong></td>
            <td class="num">${formatCurrency(s.closing * (i.purchasePrice || 0))}</td>
        </tr>`;
    }).join('');

    $('stock-count').textContent = `${items.length + 1} item${items.length === 0 ? '' : 's'}`;
}

// ==================== SALE / PURCHASE INVOICE REGISTERS ====================
function initInvoiceReportPage(type) { renderInvoiceReport(type); }

function renderInvoiceReport(type) {
    updateReportHeader(type === 'Sale' ? 'page-sale-report' : 'page-purchase-report');
    const dateFrom = $(`${type}-report-date-from`).value;
    const dateTo = $(`${type}-report-date-to`).value;
    const term = ($(`${type}-report-search`)?.value || '').trim().toLowerCase();

    let invoices = lfGetAll(LF_KEYS.INVOICES).filter(i => i.type === type);
    if (dateFrom) invoices = invoices.filter(i => i.date >= dateFrom);
    if (dateTo) invoices = invoices.filter(i => i.date <= dateTo);
    if (term) {
        invoices = invoices.filter(i =>
            (i.number || '').toLowerCase().includes(term) ||
            (i.partyName || '').toLowerCase().includes(term)
        );
    }
    invoices.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = invoices.reduce((sum, i) => sum + i.grandTotal, 0);
    $(`${type}-report-count`).textContent = invoices.length;
    $(`${type}-report-total`).textContent = formatCurrency(total);

    const tbody = $(`${type}-report-table-body`);
    if (invoices.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No invoices in this range.</td></tr>`;
        return;
    }
    tbody.innerHTML = invoices.map(inv => `
        <tr>
            <td><strong>${escapeHtml(inv.number)}</strong></td>
            <td>${escapeHtml(inv.date)}</td>
            <td>${escapeHtml(inv.partyName)}</td>
            <td class="num">${inv.hasLoad ? inv.loadQty.toLocaleString('en-US') : '-'}</td>
            <td class="num">${formatCurrency(inv.grandTotal)}</td>
            <td class="num">${inv.balanceAmount > 0 ? formatCurrency(inv.balanceAmount) : '<span class="balance-tag is-cr">Settled</span>'}</td>
        </tr>
    `).join('');
}
