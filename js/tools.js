/**
 * LedgerFlow - Tools module (Search Account / Search Item / Edit Log)
 *
 * Search Account/Item are lightweight lookups — quick access to a
 * balance or stock level without going into the full Management screens.
 * Edit Log reads from the activity trail every save/delete function
 * writes to via logActivity() (see utils.js).
 */

// ==================== SEARCH ACCOUNT ====================
function initSearchAccountPage() {
    $('sa-search').value = '';
    renderSearchAccountResults();
    setTimeout(() => $('sa-search')?.focus(), 80);
}

function renderSearchAccountResults() {
    const term = ($('sa-search')?.value || '').trim().toLowerCase();
    let accounts = lfGetAll(LF_KEYS.ACCOUNTS);

    if (term) {
        accounts = accounts.filter(a =>
            (a.title || '').toLowerCase().includes(term) ||
            (a.mobile || '').toLowerCase().includes(term) ||
            (a.city || '').toLowerCase().includes(term)
        );
    }
    accounts.sort((a, b) => a.title.localeCompare(b.title));
    $('sa-count').textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;

    const tbody = $('sa-table-body');
    if (accounts.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No matching accounts.</td></tr>`;
        return;
    }

    tbody.innerHTML = accounts.map(a => {
        const bal = computeAccountBalance(a.id);
        return `
        <tr>
            <td><strong>${escapeHtml(a.title)}</strong></td>
            <td><span class="type-badge">${escapeHtml(a.type)}</span></td>
            <td>${a.mobile ? '+92 ' + escapeHtml(a.mobile) : '-'}</td>
            <td>${escapeHtml(a.city) || '-'}</td>
            <td class="num">${balanceHtml(bal.amount, bal.side)}</td>
            <td><button class="btn-outline-text" onclick="jumpToAccountLedger('${a.id}')">View Ledger</button></td>
        </tr>`;
    }).join('');
}

function jumpToAccountLedger(accountId) {
    const link = document.querySelector('.nav-link[data-page="page-account-ledger"]');
    navigateTo('page-account-ledger', link);
    initAccountLedgerPage(accountId);
}

// ==================== SEARCH ITEM ====================
function initSearchItemPage() {
    $('si-search').value = '';
    renderSearchItemResults();
    setTimeout(() => $('si-search')?.focus(), 80);
}

function renderSearchItemResults() {
    const term = ($('si-search')?.value || '').trim().toLowerCase();
    let items = lfGetAll(LF_KEYS.ITEMS);

    if (term) {
        items = items.filter(i =>
            (i.name || '').toLowerCase().includes(term) ||
            (i.category || '').toLowerCase().includes(term)
        );
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    $('si-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    const tbody = $('si-table-body');
    if (items.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No matching items.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(i => `
        <tr>
            <td><strong>${escapeHtml(i.name)}</strong></td>
            <td>${escapeHtml(i.category) || '-'}</td>
            <td>${escapeHtml(i.unit) || '-'}</td>
            <td class="num">${computeItemCurrentStock(i.id).toLocaleString('en-US')}</td>
            <td class="num">${formatCurrency(i.purchasePrice)}</td>
            <td class="num">${formatCurrency(i.salePrice)}</td>
            <td><button class="btn-outline-text" onclick="jumpToItemLedger('${i.id}')">View Ledger</button></td>
        </tr>
    `).join('');
}

function jumpToItemLedger(itemId) {
    const link = document.querySelector('.nav-link[data-page="page-item-ledger"]');
    navigateTo('page-item-ledger', link);
    initItemLedgerPage(itemId);
}

// ==================== EDIT LOG ====================
function initEditLogPage() {
    $('el-search').value = '';
    $('el-action-filter').value = '';
    renderEditLog();
}

function renderEditLog() {
    const term = ($('el-search')?.value || '').trim().toLowerCase();
    const actionFilter = $('el-action-filter')?.value || '';

    let entries = lfGetAll(LF_KEYS.EDIT_LOG);
    if (actionFilter) entries = entries.filter(e => e.action === actionFilter);
    if (term) {
        entries = entries.filter(e =>
            (e.userEmail || '').toLowerCase().includes(term) ||
            (e.entityType || '').toLowerCase().includes(term) ||
            (e.label || '').toLowerCase().includes(term)
        );
    }
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    $('el-count').textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

    const tbody = $('el-table-body');
    if (entries.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No activity recorded yet.</td></tr>`;
        return;
    }

    const actionClass = { Created: 'is-cr', Updated: 'is-dr', Deleted: 'is-inactive' };

    tbody.innerHTML = entries.map(e => `
        <tr>
            <td>${new Date(e.timestamp).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</td>
            <td>${escapeHtml(e.userEmail)}</td>
            <td><span class="balance-tag ${actionClass[e.action] || ''}">${escapeHtml(e.action)}</span></td>
            <td><span class="type-badge">${escapeHtml(e.entityType)}</span></td>
            <td>${escapeHtml(e.label) || '-'}</td>
        </tr>
    `).join('');
}
