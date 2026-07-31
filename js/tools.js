/**
 * LedgerFlow - Tools module (Edit Log)
 *
 * Edit Log reads from the activity trail every save/delete function
 * writes to via logActivity() (see utils.js).
 */

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
