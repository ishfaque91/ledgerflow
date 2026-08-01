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
        { name: 'Sale Return', perms: ['View', 'Edit'] },
        { name: 'Add/Edit Items', perms: ['View', 'Edit'] }
    ],
    'VOUCHERS': [
        { name: 'Bank Receipt', perms: ['View', 'Edit'] },
        { name: 'Bank Payment', perms: ['View', 'Edit'] },
        { name: 'Petty Cash', perms: ['View', 'Edit'] },
        { name: 'Journal Voucher', perms: ['View', 'Edit'] },
        { name: 'Add/Edit Accounts', perms: ['Edit', 'Delete'] }
    ],
    'REPORTS': [
        { name: 'Chart of Accounts', perms: ['View'] },
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
        { name: 'Profit & Loss', perms: ['View'] },
        { name: 'Profit & Loss Graph', perms: ['View'] },
        { name: 'Income & Expense Graph', perms: ['View'] }
    ],
    'RSO / SALESMAN': [
        { name: 'RSO Customers', perms: ['View', 'Edit'] },
        { name: 'Issue Stock / Load', perms: ['View', 'Edit'] },
        { name: 'RSO Sale', perms: ['View', 'Edit'] },
        { name: 'RSO Return', perms: ['View', 'Edit'] },
        { name: 'Recovery', perms: ['View', 'Edit'] },
        { name: 'Cash Deposit', perms: ['View', 'Edit'] },
        { name: 'RSO Reports', perms: ['View'] }
    ],
    'UTILITY': [
        { name: 'Add/Edit Users', perms: ['Add', 'Edit', 'Delete'] },
        { name: 'User Rights', perms: ['View'] },
        { name: 'Edit History', perms: ['View'] },
        { name: 'Data Integrity', perms: ['View'] },
        { name: 'Backup', perms: ['View'] },
        { name: 'Change Password', perms: ['View'] },
        { name: 'Settings', perms: ['View'] }
    ]
};

// Default permissions by role — created automatically when a new user is
// added so they start with sensible access instead of seeing everything.
// Admin can still edit these later on the User Rights screen.
function buildDefaultPermissions(role) {
    const perms = {};

    if (role === 'rso') {
        const rsoGroup = RIGHTS_SCHEMA['RSO / SALESMAN'];
        rsoGroup.forEach(s => {
            s.perms.forEach(p => { perms[`RSO / SALESMAN|${s.name}|${p}`] = true; });
        });
        perms['UTILITY|Change Password|View'] = true;
    } else {
        // Staff gets Data Entry + Vouchers + basic operational reports only.
        // Financial reports (Trial Balance, Balance Sheet, P&L, Profit on
        // Sale, graphs) stay hidden — owner grants those explicitly.
        ['DATA ENTRY', 'VOUCHERS'].forEach(group => {
            RIGHTS_SCHEMA[group].forEach(s => {
                s.perms.forEach(p => { perms[`${group}|${s.name}|${p}`] = true; });
            });
        });
        const staffReports = [
            'Chart of Accounts', 'Account Ledger', 'Item Ledger',
            'Load Ledger', 'Stock Report', 'Cash Book',
            'Sale Invoices Report', 'Purchase Invoices Report'
        ];
        staffReports.forEach(name => { perms[`REPORTS|${name}|View`] = true; });
        perms['UTILITY|Change Password|View'] = true;
    }

    return perms;
}

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

// ==================== ENFORCEMENT ====================
// Everything above this point only ever wrote permissions to Firestore —
// nothing in the app actually read them back, so configuring "View only"
// for someone had no real effect. This section is what actually enforces
// it: gating sidebar visibility, page navigation, and the underlying
// save/delete actions themselves.
//
// Maps each navigable page to the Rights screen that gates it. A page not
// listed here (Dashboard, and the Accounts/Users list pages) is always
// reachable — Accounts and Users have no "View" permission in
// RIGHTS_SCHEMA by design (only Edit/Delete/Add), since picking an account
// or user is needed throughout the app; only the edit/delete actions on
// those two screens are gated, not browsing the list itself.
const PAGE_RIGHTS_MAP = {
    'page-purchase': ['DATA ENTRY', 'Purchase'],
    'page-purchase-return': ['DATA ENTRY', 'Purchase Return'],
    'page-sale': ['DATA ENTRY', 'Sale'],
    'page-sale-return': ['DATA ENTRY', 'Sale Return'],
    'page-bank-receipt': ['VOUCHERS', 'Bank Receipt'],
    'page-bank-payment': ['VOUCHERS', 'Bank Payment'],
    'page-petty-cash': ['VOUCHERS', 'Petty Cash'],
    'page-journal': ['VOUCHERS', 'Journal Voucher'],
    'page-edit-log': ['UTILITY', 'Edit History'],
    'page-chart-of-accounts': ['REPORTS', 'Chart of Accounts'],
    'page-account-ledger': ['REPORTS', 'Account Ledger'],
    'page-load-ledger': ['REPORTS', 'Load Ledger'],
    'page-item-ledger': ['REPORTS', 'Item Ledger'],
    'page-stock-report': ['REPORTS', 'Stock Report'],
    'page-cash-book': ['REPORTS', 'Cash Book'],
    'page-sale-report': ['REPORTS', 'Sale Invoices Report'],
    'page-purchase-report': ['REPORTS', 'Purchase Invoices Report'],
    'page-trial-balance': ['REPORTS', 'Trial Balance'],
    'page-balance-sheet': ['REPORTS', 'Balance Sheet'],
    'page-profit-on-sale': ['REPORTS', 'Profit on Sale'],
    'page-profit-loss': ['REPORTS', 'Profit & Loss'],
    'page-graph-pl': ['REPORTS', 'Profit & Loss Graph'],
    'page-graph-ie': ['REPORTS', 'Income & Expense Graph'],
    'page-items': ['DATA ENTRY', 'Add/Edit Items'],
    'page-accounts': ['VOUCHERS', 'Add/Edit Accounts'],
    'page-rso-customers': ['RSO / SALESMAN', 'RSO Customers'],
    'page-rso-load': ['RSO / SALESMAN', 'Issue Stock / Load'],
    'page-rso-sale': ['RSO / SALESMAN', 'RSO Sale'],
    'page-rso-return': ['RSO / SALESMAN', 'RSO Return'],
    'page-rso-recovery': ['RSO / SALESMAN', 'Recovery'],
    'page-rso-deposit': ['RSO / SALESMAN', 'Cash Deposit'],
    'page-rso-reports': ['RSO / SALESMAN', 'RSO Reports'],
    'page-integrity': ['UTILITY', 'Data Integrity'],
    'page-rights': ['UTILITY', 'User Rights'],
    'page-backup': ['UTILITY', 'Backup'],
    'page-change-password': ['UTILITY', 'Change Password'],
    'page-settings': ['UTILITY', 'Settings']
};

function getCurrentUserRecord() {
    const authUser = (typeof fbAuth !== 'undefined') ? fbAuth.currentUser : null;
    if (!authUser) return null;
    return lfGetAll(LF_KEYS.USERS).find(u => u.linkedAuthUid === authUser.uid) || null;
}

// The owner always has full access — Rights only ever restricts staff.
// Also true if the user record hasn't resolved yet (e.g. rights checked a
// moment before the USERS listener's first snapshot arrives), so nothing
// briefly blocks itself during load.
function isCurrentUserOwner() {
    const user = getCurrentUserRecord();
    return !user || user.role === 'owner';
}

// The permission check every gated action goes through. If no rights
// record exists yet, fall back to the role's default permissions so new
// staff/RSO users start with restricted access out of the box.
function hasRight(groupName, screenName, perm) {
    if (isCurrentUserOwner()) return true;
    const user = getCurrentUserRecord();
    if (!user) return true;
    const record = lfGetAll(LF_KEYS.RIGHTS).find(r => r.userId === user.id);
    const permissions = record
        ? (record.permissions || {})
        : buildDefaultPermissions(user.role || 'staff');
    return !!permissions[`${groupName}|${screenName}|${perm}`];
}

function hasPageViewRight(pageId) {
    const mapped = PAGE_RIGHTS_MAP[pageId];
    if (!mapped) return true;
    return hasRight(mapped[0], mapped[1], 'View');
}

// Hides sidebar links (and collapses a whole group if every link inside it
// is hidden) the current user doesn't have View rights for. Re-run after
// login and whenever the USERS or RIGHTS collections change live, so a
// permission change while someone's using the app takes effect immediately.
function applyNavRightsVisibility() {
    document.querySelectorAll('.sidebar .nav-link[data-page]').forEach(link => {
        link.classList.toggle('hidden', !hasPageViewRight(link.dataset.page));
    });
    document.querySelectorAll('.sidebar .nav-group').forEach(group => {
        const links = group.querySelectorAll('.nav-link[data-page]');
        if (links.length === 0) return;
        const anyVisible = [...links].some(l => !l.classList.contains('hidden'));
        group.classList.toggle('hidden', !anyVisible);
    });

    // The Dashboard's hub pages list the same destinations as the sidebar, so
    // they need the same filtering — otherwise a restricted user still sees
    // every option there and only finds out it's blocked after clicking.
    document.querySelectorAll('.dash-directory-list a[data-page]').forEach(link => {
        link.classList.toggle('hidden', !hasPageViewRight(link.dataset.page));
    });

    // A Dashboard tab whose hub page has nothing left to show is just a dead
    // end, so hide the tab too.
    document.querySelectorAll('.dash-tab[data-hub]').forEach(tab => {
        const hub = document.getElementById(tab.dataset.hub);
        if (!hub) return;
        const links = hub.querySelectorAll('.dash-directory-list a[data-page]');
        const anyVisible = [...links].some(l => !l.classList.contains('hidden'));
        tab.classList.toggle('hidden', links.length > 0 && !anyVisible);
    });
}
