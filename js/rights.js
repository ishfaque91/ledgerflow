/**
 * LedgerFlow - User Rights module (Management > User Rights)
 *
 * Two layers, matching how the person actually works:
 *  1. Quick bulk toggles at the top (whole groups on/off + a day-lockback rule)
 *  2. A searchable, per-screen permission matrix underneath for fine control
 *
 * RSO-related rows (Issue to RSO, Return from RSO, RSO Commission, and the
 * RSO-specific reports) are intentionally left out of this schema.
 */

const RIGHTS_SCHEMA = {
    'DATA ENTRY': [
        { name: 'Purchase', perms: ['View', 'Edit'] },
        { name: 'Purchase Return', perms: ['View', 'Edit'] },
        { name: 'Sale', perms: ['View', 'Edit'] },
        { name: 'Sale Return', perms: ['View', 'Edit'] }
    ],
    'VOUCHERS': [
        { name: 'Bank Receipt', perms: ['View', 'Edit'] },
        { name: 'Bank Payment', perms: ['View', 'Edit'] },
        { name: 'Petty Cash', perms: ['View', 'Edit'] },
        { name: 'Journal Voucher', perms: ['View', 'Edit'] }
    ],
    'TOOLS': [
        { name: 'Search Account', perms: ['View'] },
        { name: 'Search Item', perms: ['View'] },
        { name: 'Edit Log', perms: ['View'] }
    ],
    'REPORTS': [
        { name: 'Chart of Accounts', perms: ['View'] },
        { name: 'Account Balances', perms: ['View'] },
        { name: 'Account Ledger', perms: ['View'] },
        { name: 'Item Ledger', perms: ['View'] },
        { name: 'Load Ledger', perms: ['View'] },
        { name: 'Stock Report', perms: ['View'] },
        { name: 'Cash Book', perms: ['View'] },
        { name: 'Sale Invoices Report', perms: ['View'] },
        { name: 'Purchase Invoices Report', perms: ['View'] },
        { name: 'Trial Balance', perms: ['View'] },
        { name: 'Balance Sheet', perms: ['View'] },
        { name: 'Profit on Sale', perms: ['View'] },
        { name: 'Profit & Loss', perms: ['View'] }
    ],
    'MANAGEMENT': [
        { name: 'Add/Edit Items', perms: ['View', 'Edit'] },
        { name: 'Add/Edit Accounts', perms: ['Edit', 'Delete'] },
        { name: 'Add/Edit Users', perms: ['Add', 'Edit', 'Delete'] },
        { name: 'User Rights', perms: ['View'] }
    ],
    'UTILITY': [
        { name: 'Backup', perms: ['View'] },
        { name: 'Change Password', perms: ['View'] },
        { name: 'Settings', perms: ['View'] }
    ]
};

let currentRightsUserId = '';

// ==================== USER PICKER ====================
function populateRightsUserPicker() {
    const select = $('rights-user');
    if (!select) return;
    const users = lfGetAll(LF_KEYS.USERS);
    const previous = select.value;
    select.innerHTML = '<option value="">— users —</option>' +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.fullName)}</option>`).join('');
    if (users.some(u => u.id === previous)) select.value = previous;
}

function getRightsRecord(userId) {
    return lfGetAll(LF_KEYS.RIGHTS).find(r => r.userId === userId) || { userId, lockbackDays: 0, permissions: {} };
}

function loadRightsForUser(userId) {
    currentRightsUserId = userId;
    const record = getRightsRecord(userId);
    $('rights-lockback-days').value = record.lockbackDays ?? '';
    renderRightsTable($('rights-search')?.value || '');
    syncGroupCheckboxes();
}

// ==================== RENDER THE DETAILED MATRIX ====================
function renderRightsTable(searchTerm = '') {
    const container = $('rights-groups');
    if (!container) return;

    const term = (searchTerm || '').trim().toLowerCase();
    const record = getRightsRecord(currentRightsUserId);
    const perms = record.permissions || {};

    let html = '';
    Object.entries(RIGHTS_SCHEMA).forEach(([groupName, screens]) => {
        const visibleScreens = screens.filter(s =>
            !term ||
            groupName.toLowerCase().includes(term) ||
            s.name.toLowerCase().includes(term) ||
            s.perms.some(p => p.toLowerCase().includes(term))
        );
        if (visibleScreens.length === 0) return;

        html += `<div class="rights-group">
            <div class="rights-group-head">
                <span>${escapeHtml(groupName)}</span>
                <label class="check-row">
                    <input type="checkbox" data-group="${groupName}" onchange="toggleGroupRights(this)">
                    <span>Enable/Disable all</span>
                </label>
            </div>
            <div class="rights-group-body">
                ${visibleScreens.map(s => `
                    <div class="rights-item">
                        <span class="rights-item-name">${escapeHtml(s.name)}</span>
                        <div class="rights-item-perms">
                            ${s.perms.map(p => {
                                const key = `${groupName}|${s.name}|${p}`;
                                const checked = perms[key] ? 'checked' : '';
                                return `<label><input type="checkbox" data-key="${key}" onchange="onPermissionToggle()" ${checked}> ${p}</label>`;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    });

    container.innerHTML = html || `<p class="hint">No matching permissions.</p>`;
    syncGroupCheckboxes();
}

// ==================== BULK TOGGLES ====================
function toggleAllRights(checked) {
    document.querySelectorAll('#rights-groups input[type="checkbox"][data-key]').forEach(cb => cb.checked = checked);
    document.querySelectorAll('.rights-quick-grid input[type="checkbox"]').forEach(cb => cb.checked = checked);
    syncGroupCheckboxes();
}

function toggleGroupRights(groupCheckbox) {
    const groupName = groupCheckbox.dataset.group;
    document.querySelectorAll(`#rights-groups input[data-key^="${groupName}|"]`).forEach(cb => {
        cb.checked = groupCheckbox.checked;
    });
    // Keep the top quick-toggle for this same group (if present) in sync too
    document.querySelectorAll(`.rights-quick-grid input[data-group="${groupName}"]`).forEach(cb => {
        cb.checked = groupCheckbox.checked;
    });
}

function onPermissionToggle() {
    syncGroupCheckboxes();
}

// Reflect the real checkbox state upward into the group + "enable all" headers
function syncGroupCheckboxes() {
    Object.keys(RIGHTS_SCHEMA).forEach(groupName => {
        const groupBoxes = document.querySelectorAll(`#rights-groups input[data-key^="${groupName}|"]`);
        const allChecked = groupBoxes.length > 0 && [...groupBoxes].every(cb => cb.checked);
        document.querySelectorAll(`input[data-group="${groupName}"]`).forEach(cb => cb.checked = allChecked);
    });

    const allBoxes = document.querySelectorAll('#rights-groups input[data-key]');
    const everythingChecked = allBoxes.length > 0 && [...allBoxes].every(cb => cb.checked);
    const enableAll = $('rights-enable-all');
    if (enableAll) enableAll.checked = everythingChecked;
}

// ==================== SAVE ====================
function saveRights() {
    if (!currentRightsUserId) {
        showToast('Choose a user at the top before saving.', 'warning');
        $('rights-user').focus();
        return;
    }

    const permissions = {};
    document.querySelectorAll('#rights-groups input[data-key]').forEach(cb => {
        permissions[cb.dataset.key] = cb.checked;
    });

    const lockbackRaw = $('rights-lockback-days').value;
    const lockbackDays = lockbackRaw === '' ? 0 : parseInt(lockbackRaw, 10);

    lfUpsert(LF_KEYS.RIGHTS, {
        id: currentRightsUserId, // one rights record per user; reuse user id as record id
        userId: currentRightsUserId,
        lockbackDays,
        permissions
    });

    showToast('User rights saved.', 'success');
}
