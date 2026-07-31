/**
 * LedgerFlow - Accounts module (Management > Add/Edit Accounts)
 *
 * One unified form creates every kind of account — Customer, Supplier,
 * Cash, Bank, Income, Expense, etc. The A/c Type dropdown chosen here
 * decides the account's normal Dr/Cr side, which the balance control
 * suggests automatically (the user can still override it).
 */

const ACCOUNT_TYPES = [
    'Customer', 'Supplier', 'Customer/Supplier', 'Employee/RSO',
    'Cash', 'Bank', 'Income', 'Expense', 'Asset', 'Liability', 'Owner Equity', 'Branch'
];

// Normal balance side by account type — drives the auto-suggested Dr/Cr toggle
const NORMAL_SIDE_BY_TYPE = {
    'Asset': 'Dr',
    'Expense': 'Dr',
    'Cash': 'Dr',
    'Bank': 'Dr',
    'Customer': 'Dr',
    'Employee/RSO': 'Dr',
    'Branch': 'Dr',
    'Customer/Supplier': 'Dr',
    'Liability': 'Cr',
    'Income': 'Cr',
    'Owner Equity': 'Cr',
    'Supplier': 'Cr'
};

let currentBalanceSide = 'Dr';

// ==================== FILTER DROPDOWN (populate once) ====================
(function populateAccountTypeFilter() {
    document.addEventListener('DOMContentLoaded', () => {
        const filter = $('account-type-filter');
        if (!filter) return;
        ACCOUNT_TYPES.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type;
            opt.textContent = type;
            filter.appendChild(opt);
        });
    });
})();

// ==================== LIST / RENDER ====================
function renderAccountList(searchTerm = '') {
    const tbody = $('account-table-body');
    if (!tbody) return;

    const typeFilter = $('account-type-filter')?.value || '';
    const term = (searchTerm || '').trim().toLowerCase();

    let accounts = lfGetAll(LF_KEYS.ACCOUNTS);

    if (typeFilter) accounts = accounts.filter(a => a.type === typeFilter);
    if (term) {
        accounts = accounts.filter(a =>
            (a.title || '').toLowerCase().includes(term) ||
            (a.mobile || '').toLowerCase().includes(term) ||
            (a.city || '').toLowerCase().includes(term)
        );
    }

    accounts.sort((a, b) => a.title.localeCompare(b.title));

    $('account-count').textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;

    if (accounts.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No accounts yet — click "New Account" to add your first one.</td></tr>`;
        return;
    }

    tbody.innerHTML = accounts.map(a => `
        <tr>
            <td><strong>${escapeHtml(a.title)}</strong></td>
            <td><span class="type-badge">${escapeHtml(a.type)}</span></td>
            <td>${a.mobile ? '+92 ' + escapeHtml(a.mobile) : '-'}</td>
            <td>${escapeHtml(a.city) || '-'}</td>
            <td class="num"><span class="balance-tag ${a.openingSide === 'Cr' ? 'is-cr' : 'is-dr'}">${formatCurrency(a.openingAmount)} ${a.openingSide || 'Dr'}</span></td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openAccountForm('${a.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteAccount('${a.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ==================== FORM: OPEN / CLOSE ====================
function openAccountForm(id = null) {
    if (!hasRight('MANAGEMENT', 'Add/Edit Accounts', 'Edit')) {
        showToast(`You don't have permission to ${id ? 'edit' : 'add'} accounts.`, 'warning');
        return;
    }
    const modal = $('account-modal');
    const form = $('account-form');
    form.reset();
    $('acc-id').value = '';
    setBalanceSide('Dr');
    $('acc-type-hint').textContent = 'Choosing a type sets the normal Dr/Cr side automatically below.';

    if (id) {
        const acc = lfFindById(LF_KEYS.ACCOUNTS, id);
        if (!acc) { showToast('Account not found.', 'error'); return; }

        $('account-modal-title').textContent = 'Edit Account';
        $('acc-id').value = acc.id;
        $('acc-type').value = acc.type;
        $('acc-title').value = acc.title;
        $('acc-mobile').value = acc.mobile || '';
        $('acc-phone').value = acc.phone || '';
        $('acc-email').value = acc.email || '';
        $('acc-city').value = acc.city || '';
        $('acc-gst').value = acc.gst || '';
        $('acc-ntn').value = acc.ntn || '';
        $('acc-address').value = acc.address || '';
        $('acc-opening').value = acc.openingAmount ? acc.openingAmount.toLocaleString('en-US') : '';
        setBalanceSide(acc.openingSide || 'Dr');
        onAccountTypeChange(true);
    } else {
        $('account-modal-title').textContent = 'New Account';
    }

    modal.classList.remove('hidden');
    setTimeout(() => $('acc-type')?.focus(), 80);
}

function closeAccountForm() {
    $('account-modal').classList.add('hidden');
}

// ==================== ACCOUNT TYPE -> SUGGESTED DR/CR ====================
function onAccountTypeChange(isEditing = false) {
    const type = $('acc-type').value;
    if (!type) return;

    const suggested = NORMAL_SIDE_BY_TYPE[type] || 'Dr';
    const hint = $('acc-type-hint');

    if (!isEditing) setBalanceSide(suggested);

    hint.textContent = `${type} accounts normally run ${suggested === 'Dr' ? 'Debit' : 'Credit'} — you can still switch sides if this account is an exception.`;
}

function setBalanceSide(side) {
    currentBalanceSide = side;
    document.querySelectorAll('.balance-side').forEach(btn => {
        btn.classList.toggle('is-selected', btn.dataset.side === side);
    });
}

// ==================== VALIDATION + SAVE ====================
async function saveAccount() {
    const id = $('acc-id').value;
    const type = $('acc-type').value;
    const title = sanitizeInput($('acc-title').value);
    const mobileDigits = getDigitsOnly($('acc-mobile').value);
    const phoneDigits = getDigitsOnly($('acc-phone').value);
    const email = sanitizeInput($('acc-email').value);
    const city = sanitizeInput($('acc-city').value);
    const gst = sanitizeInput($('acc-gst').value);
    const ntn = sanitizeInput($('acc-ntn').value);
    const address = sanitizeInput($('acc-address').value);
    const openingAmount = parseAmount($('acc-opening').value);
    const saveBtn = $('account-save-btn');

    if (!hasRight('MANAGEMENT', 'Add/Edit Accounts', 'Edit')) {
        showToast("You don't have permission to save accounts.", 'warning');
        return;
    }
    if (!type) { showToast('Please choose an A/c Type.', 'warning'); $('acc-type').focus(); return; }
    if (!title) { showToast('Please enter the A/c Title.', 'warning'); $('acc-title').focus(); return; }

    const duplicate = lfGetAll(LF_KEYS.ACCOUNTS).find(a => a.title.trim().toLowerCase() === title.toLowerCase() && a.id !== id);
    if (duplicate) { showToast('An account with this exact title already exists.', 'error'); $('acc-title').focus(); return; }

    if (mobileDigits && !isValidPakMobile(mobileDigits)) {
        showToast('Mobile number should be 10 digits after +92, starting with 3 — e.g. 333 2392852.', 'warning');
        $('acc-mobile').focus();
        return;
    }
    if (email && !isValidEmail(email)) { showToast('Please enter a valid email address.', 'warning'); $('acc-email').focus(); return; }
    if (openingAmount < 0) { showToast('Opening balance can\'t be negative — use the Debit/Credit toggle to set which side it belongs on.', 'warning'); return; }

    setBtnLoading(saveBtn, true);

    const record = {
        id: id || undefined,
        type, title,
        mobile: mobileDigits, phone: phoneDigits,
        email, city, gst, ntn, address,
        openingAmount, openingSide: currentBalanceSide
    };

    try {
        await lfUpsert(LF_KEYS.ACCOUNTS, record);
        showToast(id ? 'Account updated.' : 'Account created.', 'success');
        logActivity(id ? 'Updated' : 'Created', 'Account', title);
        closeAccountForm();
    } catch (e) {
        console.error(e);
        showToast('Something went wrong while saving.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteAccount(id) {
    const acc = lfFindById(LF_KEYS.ACCOUNTS, id);
    if (!acc) return;
    if (!hasRight('MANAGEMENT', 'Add/Edit Accounts', 'Delete')) {
        showToast("You don't have permission to delete accounts.", 'warning');
        return;
    }
    // Deleting an account that already has ledger history would silently
    // drop its side of every past transaction from Trial Balance/Balance
    // Sheet while the other side stays — the books stop balancing with no
    // warning. Block it instead; accounts with history get deactivated in
    // spirit (stop using them), not deleted.
    const usageCount = lfGetAll(LF_KEYS.ACCOUNT_LEDGER).filter(e => e.accountId === id).length;
    if (usageCount > 0) {
        showToast(`Can't delete "${acc.title}" — it has ${usageCount} ledger ${usageCount === 1 ? 'entry' : 'entries'} from past transactions. Deleting it would break your reports. Simply stop using it instead.`, 'error', 7000);
        return;
    }
    if (!confirm(`Delete "${acc.title}"? This cannot be undone.`)) return;
    try {
        await lfDelete(LF_KEYS.ACCOUNTS, id);
        showToast('Account deleted.', 'success');
        logActivity('Deleted', 'Account', acc.title);
    } catch (e) {
        console.error(e);
        showToast('Could not delete — please try again.', 'error');
    }
}

function setBtnLoading(btn, isLoading) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.querySelector('.btn-label').classList.toggle('hidden', isLoading);
    btn.querySelector('.btn-spinner').classList.toggle('hidden', !isLoading);
}
