let companiesCache = [];
let companiesUnsub = null;
let currentDetailId = null;

const WIPE_COLLECTIONS = [
    'accounts', 'items', 'users', 'rights', 'invoices',
    'accountLedger', 'loadLedger', 'itemLedger',
    'vouchers', 'editLog', 'SETTINGS',
    'rsoCustomers', 'rsoSales', 'rsoReturns',
    'rsoRecoveries', 'rsoLoads', 'rsoDeposits'
];

function setBtnLoading(btn, isLoading) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', isLoading);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !isLoading);
}

// ==================== TRIAL / STATUS CALCULATIONS ====================
function getTrialEndDate(company) {
    if (company.status === 'active' && company.activeUntil) {
        return new Date(company.activeUntil);
    }
    const start = new Date(company.signupDate);
    const days = parseInt(company.trialDays, 10) || 30;
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    return end;
}

function getDaysLeft(company) {
    const end = getTrialEndDate(company);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.round((end - today) / (1000 * 60 * 60 * 24));
}

function getStatusDisplay(company) {
    if (company.status === 'suspended') return { label: 'Suspended', cls: 'is-suspended' };
    if (company.status === 'active') {
        if (!company.activeUntil) return { label: 'Active', cls: 'is-active' };
        const daysLeft = getDaysLeft(company);
        if (daysLeft < 0) return { label: 'Subscription expired', cls: 'is-expired', daysLeft };
        return { label: `Active — ${daysLeft}d left`, cls: 'is-active', daysLeft };
    }
    const daysLeft = getDaysLeft(company);
    if (daysLeft < 0) return { label: 'Trial expired', cls: 'is-expired', daysLeft };
    return { label: `Trial — ${daysLeft}d left`, cls: 'is-trial', daysLeft };
}

// ==================== LIVE COMPANY LIST ====================
function watchCompanies() {
    if (companiesUnsub) return;
    companiesUnsub = fbDb.collection('companies').onSnapshot(
        snapshot => {
            companiesCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            renderCompanyList($('sap-search')?.value || '');
            if (currentDetailId) {
                const still = companiesCache.find(c => c.id === currentDetailId);
                if (still) renderDetailView(still);
            }
        },
        err => {
            console.error('[SuperAdmin] Companies listener failed:', err);
            showToast('Could not load companies — check your Super Admin access.', 'error');
        }
    );
}

function stopWatchingCompanies() {
    if (companiesUnsub) { companiesUnsub(); companiesUnsub = null; }
    companiesCache = [];
}

// ==================== LIST VIEW ====================
function renderCompanyList(search = '') {
    const term = (search || '').trim().toLowerCase();
    const statusFilter = $('sap-status-filter')?.value || '';

    let companies = companiesCache.slice();
    if (term) {
        companies = companies.filter(c =>
            (c.companyName || '').toLowerCase().includes(term) ||
            (c.ownerEmail || '').toLowerCase().includes(term)
        );
    }
    if (statusFilter) companies = companies.filter(c => c.status === statusFilter);
    companies.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

    $('sap-list-count').textContent = `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}`;

    const grid = $('sap-company-grid');
    if (companies.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem 1rem; color:var(--ink-faint);">
            <p style="font-size:1.1rem; font-weight:600;">No companies found</p>
            <p style="font-size:0.85rem;">They'll appear here automatically once someone signs up.</p>
        </div>`;
    } else {
        grid.innerHTML = companies.map(c => {
            const status = getStatusDisplay(c);
            return `<div class="company-card" onclick="openDetailView('${c.id}')">
                <div class="company-card-name">${escapeHtml(c.companyName)}</div>
                <div class="company-card-email">${escapeHtml(c.ownerEmail || '—')}</div>
                <div class="company-card-bottom">
                    <span class="status-badge ${status.cls}">${status.label}</span>
                    <svg class="company-card-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
            </div>`;
        }).join('');
    }

    renderSummary(companiesCache);
    renderExpiringBanner(companiesCache);
}

function renderSummary(companies) {
    $('sap-count-total').textContent = companies.length;
    $('sap-count-trial').textContent = companies.filter(c => c.status === 'trial').length;
    $('sap-count-active').textContent = companies.filter(c => c.status === 'active').length;
    $('sap-count-suspended').textContent = companies.filter(c => c.status === 'suspended').length;
}

function renderExpiringBanner(companies) {
    const soon = companies
        .filter(c => c.status === 'trial' || (c.status === 'active' && c.activeUntil))
        .map(c => ({ c, daysLeft: getDaysLeft(c) }))
        .filter(x => x.daysLeft <= 5);

    const banner = $('sap-expiring-banner');
    if (soon.length === 0) { banner.classList.add('hidden'); return; }

    banner.classList.remove('hidden');
    soon.sort((a, b) => a.daysLeft - b.daysLeft);
    $('sap-expiring-list').innerHTML = soon.map(({ c, daysLeft }) => `
        <div class="statement-row" style="cursor:pointer;" onclick="openDetailView('${c.id}')">
            <span>${escapeHtml(c.companyName)}</span>
            <span class="${daysLeft < 0 ? 'days-left-tag is-soon' : 'days-left-tag'}">${daysLeft < 0 ? Math.abs(daysLeft) + 'd overdue' : daysLeft + 'd left'}</span>
        </div>
    `).join('');
}

// ==================== DETAIL VIEW ====================
function showListView() {
    currentDetailId = null;
    $('list-view').style.display = '';
    $('detail-view').classList.remove('is-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDetailView(id) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) { showToast('Company not found.', 'error'); return; }
    currentDetailId = id;
    $('list-view').style.display = 'none';
    renderDetailView(c);
    $('detail-view').classList.add('is-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDetailView(c) {
    const status = getStatusDisplay(c);
    const trialEnd = getTrialEndDate(c).toISOString().slice(0, 10);
    const daysLeft = getDaysLeft(c);

    $('detail-company-name').textContent = c.companyName || '—';
    const badge = $('detail-status-badge');
    badge.className = `status-badge ${status.cls}`;
    badge.textContent = status.label;

    $('detail-info-grid').innerHTML = `
        <div class="detail-info-card">
            <div class="detail-info-label">Owner Email</div>
            <div class="detail-info-value">${escapeHtml(c.ownerEmail || '—')}</div>
        </div>
        <div class="detail-info-card">
            <div class="detail-info-label">Phone</div>
            <div class="detail-info-value">${c.ownerPhone ? '+92 ' + escapeHtml(c.ownerPhone) : '—'}</div>
        </div>
        <div class="detail-info-card">
            <div class="detail-info-label">City</div>
            <div class="detail-info-value">${escapeHtml(c.city || '—')}</div>
        </div>
        <div class="detail-info-card">
            <div class="detail-info-label">Signup Date</div>
            <div class="detail-info-value">${escapeHtml(c.signupDate || '—')}</div>
        </div>
        <div class="detail-info-card">
            <div class="detail-info-label">Expires</div>
            <div class="detail-info-value">${trialEnd}${daysLeft >= 0 ? ` (${daysLeft}d left)` : ` (${Math.abs(daysLeft)}d overdue)`}</div>
        </div>
        <div class="detail-info-card">
            <div class="detail-info-label">Plan</div>
            <div class="detail-info-value">${escapeHtml(c.planLabel || '—')}</div>
        </div>`;

    // SVG icons for action cards
    const icons = {
        activate: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        renew: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
        suspend: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
        extend: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        loaddata: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
        edit: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        wipe: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
        delete: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
    };

    let actionsHtml = '';

    if (c.status === 'active') {
        actionsHtml += `
            <div class="action-card action-renew" onclick="openDurationModal('${c.id}','renew')">
                <div class="action-card-icon">${icons.renew}</div>
                <div class="action-card-title">Renew</div>
                <div class="action-card-desc">Extend the subscription period</div>
            </div>
            <div class="action-card action-suspend" onclick="suspendCompany('${c.id}')">
                <div class="action-card-icon">${icons.suspend}</div>
                <div class="action-card-title">Suspend</div>
                <div class="action-card-desc">Lock out until reactivated</div>
            </div>`;
    } else {
        actionsHtml += `
            <div class="action-card action-activate" onclick="openDurationModal('${c.id}','activate')">
                <div class="action-card-icon">${icons.activate}</div>
                <div class="action-card-title">Activate</div>
                <div class="action-card-desc">Start a paid subscription</div>
            </div>`;
        if (c.status !== 'suspended') {
            actionsHtml += `
                <div class="action-card action-extend" onclick="extendTrial('${c.id}')">
                    <div class="action-card-icon">${icons.extend}</div>
                    <div class="action-card-title">Extend Trial</div>
                    <div class="action-card-desc">Add 30 more trial days</div>
                </div>`;
        }
    }

    actionsHtml += `
        <div class="action-card action-loaddata" onclick="openLoadDataPanel('${c.id}')">
            <div class="action-card-icon">${icons.loaddata}</div>
            <div class="action-card-title">Load Data</div>
            <div class="action-card-desc">Import master data from Excel</div>
        </div>
        <div class="action-card action-edit" onclick="openCompanyForm('${c.id}')">
            <div class="action-card-icon">${icons.edit}</div>
            <div class="action-card-title">Edit Details</div>
            <div class="action-card-desc">Update company information</div>
        </div>
        <div class="action-card action-wipe" onclick="openWipeModal('${c.id}')">
            <div class="action-card-icon">${icons.wipe}</div>
            <div class="action-card-title">Wipe Data</div>
            <div class="action-card-desc">Delete all company data permanently</div>
        </div>
        <div class="action-card action-delete" onclick="deleteCompany('${c.id}')">
            <div class="action-card-icon">${icons.delete}</div>
            <div class="action-card-title">Delete Company</div>
            <div class="action-card-desc">Delete all data, users & Auth logins permanently</div>
        </div>`;

    $('detail-actions').innerHTML = actionsHtml;

    const notesSection = $('detail-notes-section');
    if (c.notes) {
        notesSection.classList.remove('hidden');
        $('detail-notes-text').textContent = c.notes;
    } else {
        notesSection.classList.add('hidden');
    }
}

// ==================== ACTIVATE / RENEW ====================
let durationModalCompanyId = null;
let durationModalMode = null;

function openDurationModal(id, mode) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) return;
    durationModalCompanyId = id;
    durationModalMode = mode;
    $('duration-modal-title').textContent = mode === 'renew' ? `Renew ${c.companyName}` : `Activate ${c.companyName}`;
    $('duration-days').value = 30;
    $('duration-modal').classList.remove('hidden');
    setTimeout(() => $('duration-days')?.focus(), 80);
}

function closeDurationModal() { $('duration-modal').classList.add('hidden'); }

function setDurationPreset(days) { $('duration-days').value = days; }

async function confirmDuration() {
    const days = parseInt($('duration-days').value, 10);
    if (!days || days <= 0) { showToast('Enter a valid number of days.', 'warning'); return; }

    const c = companiesCache.find(x => x.id === durationModalCompanyId);
    if (!c) return;
    const btn = $('duration-confirm-btn');
    setBtnLoading(btn, true);

    try {
        const base = (durationModalMode === 'renew' && c.activeUntil && new Date(c.activeUntil) > new Date())
            ? new Date(c.activeUntil)
            : new Date();
        base.setDate(base.getDate() + days);

        await fbDb.collection('companies').doc(c.id).update({
            status: 'active',
            activeUntil: base.toISOString().slice(0, 10)
        });

        showToast(
            durationModalMode === 'renew'
                ? `${c.companyName} renewed — ${days} more days added.`
                : `${c.companyName} activated for ${days} days.`,
            'success'
        );
        closeDurationModal();
    } catch (e) {
        console.error(e);
        showToast('Could not update — please try again.', 'error');
    } finally {
        setBtnLoading(btn, false);
    }
}

async function suspendCompany(id) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`Suspend ${c.companyName}? They'll be locked out until reactivated.`)) return;
    try {
        await fbDb.collection('companies').doc(id).update({ status: 'suspended' });
        showToast(`${c.companyName} suspended.`, 'warning');
    } catch (e) {
        console.error(e);
        showToast('Could not suspend — please try again.', 'error');
    }
}

async function extendTrial(id) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) return;
    const newDays = (parseInt(c.trialDays, 10) || 30) + 30;
    try {
        await fbDb.collection('companies').doc(id).update({ trialDays: newDays });
        showToast(`Trial extended by 30 days for ${c.companyName}.`, 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not extend trial — please try again.', 'error');
    }
}

async function deleteCompany(id) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`Permanently delete ${c.companyName}?\n\nThis will:\n• Delete ALL company data (invoices, ledgers, accounts, etc.)\n• Delete ALL users including the owner\n• Remove their Firebase Auth logins\n\nThis CANNOT be undone.`)) return;
    if (!confirm(`Are you absolutely sure? Type OK in the next prompt to confirm.`)) return;

    try {
        showToast(`Deleting ${c.companyName}...`, 'info', 5000);
        const companyRef = fbDb.collection('companies').doc(id);
        const deleteAuthUser = firebase.functions().httpsCallable('deleteAuthUser');

        const usersSnap = await companyRef.collection('users').get();
        for (const doc of usersSnap.docs) {
            const u = doc.data();
            if (u.linkedAuthUid) {
                try { await deleteAuthUser({ uid: u.linkedAuthUid }); } catch (e) {
                    console.warn('[Delete] Could not delete auth user:', u.linkedAuthUid, e.message);
                }
                try { await fbDb.collection('users').doc(u.linkedAuthUid).delete(); } catch (e) {
                    console.warn('[Delete] Could not delete user mapping:', u.linkedAuthUid, e.message);
                }
            }
        }

        if (c.ownerUid) {
            try { await deleteAuthUser({ uid: c.ownerUid }); } catch (e) {
                console.warn('[Delete] Could not delete owner auth:', e.message);
            }
            try { await fbDb.collection('users').doc(c.ownerUid).delete(); } catch (e) {
                console.warn('[Delete] Could not delete owner mapping:', e.message);
            }
        }

        for (const colName of WIPE_COLLECTIONS) {
            await deleteSubcollection(companyRef, colName);
        }
        await deleteSubcollection(companyRef, 'users');

        await companyRef.delete();
        showToast(`${c.companyName} and all its users permanently deleted.`, 'success');
        showListView();
    } catch (e) {
        console.error(e);
        showToast('Could not fully delete — some data may remain. Check console.', 'error');
    }
}

// ==================== WIPE DATA ====================
let wipeTargetId = null;

function openWipeModal(id) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) return;
    wipeTargetId = id;
    $('wipe-confirm-name').textContent = c.companyName;
    $('wipe-confirm-input').value = '';
    $('wipe-progress').classList.add('hidden');
    $('wipe-progress-fill').style.width = '0%';
    $('wipe-confirm-btn').disabled = false;
    $('wipe-modal').classList.remove('hidden');
    setTimeout(() => $('wipe-confirm-input')?.focus(), 80);
}

function closeWipeModal() {
    $('wipe-modal').classList.add('hidden');
    wipeTargetId = null;
}

async function confirmWipeData() {
    const c = companiesCache.find(x => x.id === wipeTargetId);
    if (!c) return;

    const typed = $('wipe-confirm-input').value.trim();
    if (typed !== c.companyName) {
        showToast('Company name does not match. Type it exactly to confirm.', 'warning');
        $('wipe-confirm-input').focus();
        return;
    }

    const btn = $('wipe-confirm-btn');
    setBtnLoading(btn, true);
    $('wipe-progress').classList.remove('hidden');

    const companyRef = fbDb.collection('companies').doc(c.id);
    let completed = 0;

    try {
        for (const colName of WIPE_COLLECTIONS) {
            $('wipe-progress-text').textContent = `Deleting ${colName}...`;
            if (colName === 'USERS') {
                await deleteUsersExceptOwner(companyRef);
            } else {
                await deleteSubcollection(companyRef, colName);
            }
            completed++;
            $('wipe-progress-fill').style.width = `${Math.round((completed / WIPE_COLLECTIONS.length) * 100)}%`;
        }

        $('wipe-progress-text').textContent = 'All data wiped. Owner user preserved.';
        showToast(`All data wiped for ${c.companyName}. Owner user kept.`, 'success');
        setTimeout(() => closeWipeModal(), 1200);
    } catch (e) {
        console.error('[Wipe] Error:', e);
        $('wipe-progress-text').textContent = `Error: ${e.message}`;
        showToast('Wipe failed — some data may remain. Try again.', 'error');
    } finally {
        setBtnLoading(btn, false);
    }
}

async function deleteUsersExceptOwner(companyRef) {
    const batchSize = 200;
    const snapshot = await companyRef.collection('users').get();
    const toDelete = snapshot.docs.filter(doc => {
        const data = doc.data();
        return data.role !== 'owner';
    });

    for (let i = 0; i < toDelete.length; i += batchSize) {
        const batch = fbDb.batch();
        toDelete.slice(i, i + batchSize).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
}

async function deleteSubcollection(companyRef, collectionName) {
    const batchSize = 200;
    let snapshot = await companyRef.collection(collectionName).limit(batchSize).get();

    while (snapshot.size > 0) {
        const batch = fbDb.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        if (snapshot.size < batchSize) break;
        snapshot = await companyRef.collection(collectionName).limit(batchSize).get();
    }
}

// ==================== EDIT COMPANY FORM ====================
function openCompanyForm(id) {
    const c = companiesCache.find(x => x.id === id);
    if (!c) { showToast('Company not found.', 'error'); return; }

    $('company-form').reset();
    $('co-id').value = c.id;
    $('co-owner-email').textContent = c.ownerEmail || '—';
    $('co-name').value = c.companyName || '';
    $('co-contact-phone').value = c.ownerPhone || '';
    $('co-city').value = c.city || '';
    $('co-signup-date').value = c.signupDate || '';
    $('co-trial-days').value = c.trialDays || 30;
    $('co-plan').value = c.planLabel || '';
    $('co-notes').value = c.notes || '';

    $('company-modal').classList.remove('hidden');
    setTimeout(() => $('co-name')?.focus(), 80);
}

function closeCompanyForm() { $('company-modal').classList.add('hidden'); }

async function saveCompany() {
    const id = $('co-id').value;
    const companyName = sanitizeInput($('co-name').value);
    const ownerPhone = getDigitsOnly($('co-contact-phone').value);
    const city = sanitizeInput($('co-city').value);
    const signupDate = $('co-signup-date').value;
    const trialDays = parseInt($('co-trial-days').value, 10) || 30;
    const planLabel = sanitizeInput($('co-plan').value);
    const notes = sanitizeInput($('co-notes').value);
    const saveBtn = $('company-save-btn');

    if (!companyName) { showToast('Please enter the company name.', 'warning'); $('co-name').focus(); return; }
    if (!signupDate) { showToast('Please choose the signup date.', 'warning'); return; }
    if (ownerPhone && !isValidPakMobile(ownerPhone)) {
        showToast('Phone should be 10 digits after +92, starting with 3.', 'warning');
        return;
    }

    setBtnLoading(saveBtn, true);
    try {
        await fbDb.collection('companies').doc(id).update({
            companyName, ownerPhone, city, signupDate, trialDays, planLabel, notes
        });
        showToast('Company updated.', 'success');
        closeCompanyForm();
    } catch (e) {
        console.error(e);
        showToast('Something went wrong while saving.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

// ==================== CREATE COMPANY ====================
const DEFAULT_COA = [
    { title: 'Cash in Hand', type: 'Cash', openingAmount: 0, openingSide: 'Dr' },
    { title: 'Bank Account', type: 'Bank', openingAmount: 0, openingSide: 'Dr' },
    { title: 'Sales Income', type: 'Income', openingAmount: 0, openingSide: 'Cr' },
    { title: 'General Expense', type: 'Expense', openingAmount: 0, openingSide: 'Dr' },
    { title: 'Owner Equity', type: 'Owner Equity', openingAmount: 0, openingSide: 'Cr' },
    { title: 'Accounts Receivable', type: 'Customer', openingAmount: 0, openingSide: 'Dr' },
    { title: 'Accounts Payable', type: 'Supplier', openingAmount: 0, openingSide: 'Cr' },
    { title: 'Fixed Assets', type: 'Asset', openingAmount: 0, openingSide: 'Dr' },
    { title: 'Liability', type: 'Liability', openingAmount: 0, openingSide: 'Cr' }
];

function openCreateCompanyModal() {
    $('create-company-form').reset();
    $('cc-trial-days').value = '30';
    $('cc-default-coa').checked = true;
    $('cc-progress').style.display = 'none';
    $('create-company-modal').classList.remove('hidden');
    setTimeout(() => $('cc-name')?.focus(), 80);
}

function closeCreateCompanyModal() {
    $('create-company-modal').classList.add('hidden');
}

async function createCompany() {
    const companyName = sanitizeInput($('cc-name').value);
    const ownerName = sanitizeInput($('cc-owner-name').value);
    const email = sanitizeInput($('cc-email').value).toLowerCase();
    const password = $('cc-password').value;
    const phone = getDigitsOnly($('cc-phone').value);
    const city = sanitizeInput($('cc-city').value);
    const trialDays = parseInt($('cc-trial-days').value, 10) || 30;
    const planLabel = sanitizeInput($('cc-plan').value);
    const seedCoa = $('cc-default-coa').checked;
    const saveBtn = $('cc-save-btn');
    const progress = $('cc-progress');

    if (!companyName) { showToast('Enter a company name.', 'warning'); return; }
    if (!ownerName) { showToast('Enter the owner name.', 'warning'); return; }
    if (!email) { showToast('Enter an email for the owner login.', 'warning'); return; }
    if (!password || password.length < 6) { showToast('Password must be at least 6 characters.', 'warning'); return; }
    if (phone && !isValidPakMobile(phone)) { showToast('Phone should be 10 digits after +92, starting with 3.', 'warning'); return; }

    setBtnLoading(saveBtn, true);
    progress.style.display = '';
    progress.textContent = 'Creating auth user...';

    let secondaryApp = null;
    let newUser = null;

    try {
        secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary_' + Date.now());
        const secondaryAuth = secondaryApp.auth();
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        newUser = cred.user;
        const uid = newUser.uid;
        await secondaryAuth.signOut();

        progress.textContent = 'Creating company record...';

        const companyDocRef = fbDb.collection('companies').doc();
        const companyId = companyDocRef.id;
        const today = new Date().toISOString().slice(0, 10);

        await fbDb.collection('users').doc(uid).set({
            companyId, email, fullName: ownerName, role: 'owner'
        });

        await companyDocRef.set({
            companyName, status: 'trial', signupDate: today, trialDays,
            ownerUid: uid, ownerEmail: email, ownerPhone: phone, city,
            planLabel,
            settings: { companyName, currencyLabel: 'Rs.', theme: 'light' },
            createdAt: new Date().toISOString()
        });

        await companyDocRef.collection('users').add({
            fullName: ownerName, username: email, status: 'Active',
            linkedAuthUid: uid, role: 'owner',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        if (seedCoa) {
            progress.textContent = 'Seeding Chart of Accounts...';
            const batch = fbDb.batch();
            DEFAULT_COA.forEach(acc => {
                const ref = companyDocRef.collection('accounts').doc();
                batch.set(ref, {
                    ...acc,
                    id: ref.id,
                    createdAt: new Date().toISOString()
                });
            });
            await batch.commit();
        }

        showToast(`Company "${companyName}" created with owner ${email}.`, 'success');
        closeCreateCompanyModal();
    } catch (e) {
        console.error('[CreateCompany] Failed:', e);
        showToast('Create failed: ' + (e.message || 'Unknown error'), 'error');
        progress.textContent = 'Error: ' + e.message;
    } finally {
        if (secondaryApp) {
            try { await secondaryApp.delete(); } catch (_) {}
        }
        setBtnLoading(saveBtn, false);
    }
}

// ==================== LOGIN / LOGOUT ====================
async function handleLogin() {
    const email = sanitizeInput($('login-email').value).toLowerCase();
    const password = $('login-password').value;
    const btn = $('login-submit-btn');

    if (!email || !password) { showToast('Enter both email and password.', 'warning'); return; }

    setBtnLoading(btn, true);
    try {
        await fbAuth.signInWithEmailAndPassword(email, password);
    } catch (e) {
        console.error('[SuperAdmin] Login failed:', e);
        showToast('Incorrect email or password.', 'error');
        setBtnLoading(btn, false);
    }
}

function handleLogout() {
    fbAuth.signOut();
    stopWatchingCompanies();
    showLoginScreen();
    showToast('Logged out.', 'info', 1500);
}

function showLoginScreen() {
    $('app-loading-screen')?.classList.add('hidden');
    $('app-root').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-email').value = '';
    $('login-password').value = '';
    setBtnLoading($('login-submit-btn'), false);
    setTimeout(() => $('login-email')?.focus(), 50);
}

async function showApp(user) {
    $('app-loading-screen')?.classList.add('hidden');
    $('login-screen').classList.add('hidden');
    $('app-root').classList.remove('hidden');
    $('active-admin-chip').textContent = user.email;
    watchCompanies();
}

document.addEventListener('DOMContentLoaded', () => {
    fbAuth.onAuthStateChanged(async user => {
        if (!user) {
            stopWatchingCompanies();
            showLoginScreen();
            return;
        }

        try {
            const superAdminDoc = await fbDb.collection('superAdmins').doc(user.uid).get();
            if (!superAdminDoc.exists) {
                showToast('This account is not authorized for Super Admin access.', 'error');
                await fbAuth.signOut();
                showLoginScreen();
                return;
            }
            showApp(user);
        } catch (e) {
            console.error('[SuperAdmin] Access check failed:', e);
            showToast('Could not verify Super Admin access.', 'error');
            await fbAuth.signOut();
            showLoginScreen();
        }
    });

    $('login-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    const zone = document.getElementById('ld-upload-zone');
    if (zone) {
        zone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') document.getElementById('ld-file-input').click(); });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
        zone.addEventListener('drop', (e) => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
                const input = document.getElementById('ld-file-input');
                const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files;
                onLdFileSelected(input);
            } else { showToast('Please drop an Excel (.xlsx) file.', 'warning'); }
        });
    }
});

// ==================== LOAD DATA (EXCEL IMPORT) ====================
const LD_CONFIGS = {
    accounts: {
        title: 'Accounts', collection: 'accounts',
        columns: ['Title', 'Type', 'Opening Balance', 'Phone', 'City'],
        required: ['Title', 'Type'],
        validTypes: ['Customer', 'Supplier', 'Customer/Supplier', 'Employee/RSO', 'Employee/BTL', 'Cash', 'Bank', 'Income', 'Expense', 'Asset', 'Liability'],
        template: [['Title','Type','Opening Balance','Phone','City'],['Ali General Store','Customer',5000,'0333-1234567','Karachi'],['Habib Bank','Bank',50000,'','']]
    },
    items: {
        title: 'Items Catalog', collection: 'items',
        columns: ['Item Name', 'Purchase Price', 'Sale Price'],
        required: ['Item Name'],
        template: [['Item Name','Purchase Price','Sale Price'],['AWAMI SIM',200,0],['Super Card 100',95,100]]
    },
    rso: {
        title: 'RSO Agents', collection: 'users',
        columns: ['Full Name', 'Mobile', 'CNIC', 'Area'],
        required: ['Full Name'],
        template: [['Full Name','Mobile','CNIC','Area'],['Ahmed Ali','0333-1234567','42101-1234567-1','Nazimabad']]
    },
    btl: {
        title: 'BTL Agents', collection: 'btlAgents',
        columns: ['Agent Name', 'Mobile', 'CNIC', 'Area / Stall'],
        required: ['Agent Name'],
        template: [['Agent Name','Mobile','CNIC','Area / Stall'],['Faisal Hussain','0312-5551234','42101-3456789-1','Tariq Road Stall']]
    },
    rso_customers: {
        title: 'RSO Customers', collection: 'rsoCustomers',
        columns: ['Customer Name', 'Shop Name', 'Mobile', 'Area', 'RSO Name', 'Credit Limit'],
        required: ['Customer Name', 'RSO Name'],
        template: [['Customer Name','Shop Name','Mobile','Area','RSO Name','Credit Limit'],['Fauji','Fauji Telecom','0333-1112222','Block 3','Ahmed Ali',5000]]
    }
};

let _ldCompanyId = null;
let _ldCategory = null;
let _ldParsed = [];
let _ldErrors = 0;

function openLoadDataPanel(companyId) {
    _ldCompanyId = companyId;
    _ldCategory = null;
    _ldParsed = [];
    _ldErrors = 0;
    const c = companiesCache.find(x => x.id === companyId);
    $('loaddata-modal-title').textContent = `Load Data — ${c ? c.companyName : ''}`;
    $('ld-step-category').classList.remove('hidden');
    $('ld-step-upload').classList.add('hidden');
    $('ld-step-preview').classList.add('hidden');
    $('ld-import-btn').classList.add('hidden');
    $('loaddata-modal').classList.remove('hidden');
}

function closeLoadDataPanel() {
    $('loaddata-modal').classList.add('hidden');
    _ldCompanyId = null; _ldCategory = null; _ldParsed = [];
}

function selectLoadDataCategory(cat) {
    _ldCategory = cat;
    $('ld-step-category').classList.add('hidden');
    $('ld-step-upload').classList.remove('hidden');
    $('ld-step-preview').classList.add('hidden');
    $('ld-import-btn').classList.add('hidden');
    $('ld-file-input').value = '';
}

function backToLdCategories() {
    $('ld-step-category').classList.remove('hidden');
    $('ld-step-upload').classList.add('hidden');
    $('ld-step-preview').classList.add('hidden');
    $('ld-import-btn').classList.add('hidden');
    _ldCategory = null; _ldParsed = [];
}

function backToLdUpload() {
    $('ld-step-upload').classList.remove('hidden');
    $('ld-step-preview').classList.add('hidden');
    $('ld-import-btn').classList.add('hidden');
    $('ld-file-input').value = '';
    _ldParsed = [];
}

function downloadLdTemplate() {
    const config = LD_CONFIGS[_ldCategory];
    const ws = XLSX.utils.aoa_to_sheet(config.template);
    ws['!cols'] = config.columns.map(c => ({ wch: Math.max(c.length + 4, 18) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.title);
    XLSX.writeFile(wb, `${_ldCategory}_template.xlsx`);
}

function onLdFileSelected(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (raw.length === 0) { showToast('Excel file is empty.', 'warning'); return; }
            parseLdData(raw);
        } catch (err) { console.error(err); showToast('Could not read the Excel file.', 'error'); }
    };
    reader.readAsArrayBuffer(file);
}

async function parseLdData(raw) {
    const config = LD_CONFIGS[_ldCategory];
    const headers = config.columns;
    const fileHeaders = Object.keys(raw[0]);
    const colMap = {};
    headers.forEach(h => {
        const match = fileHeaders.find(fh => fh.trim().toLowerCase() === h.toLowerCase());
        colMap[h] = match || null;
    });

    const missingReq = config.required.filter(r => !colMap[r]);
    if (missingReq.length > 0) { showToast(`Missing required columns: ${missingReq.join(', ')}`, 'error'); return; }

    const companyRef = fbDb.collection('companies').doc(_ldCompanyId);
    const existingNames = new Set();

    try {
        const snap = await companyRef.collection(config.collection).get();
        snap.docs.forEach(doc => {
            const d = doc.data();
            const name = (d.title || d.name || d.fullName || '').toLowerCase();
            if (name) existingNames.add(name);
        });
    } catch (_) {}

    _ldParsed = [];
    _ldErrors = 0;
    let duplicates = 0;

    raw.forEach((row, idx) => {
        const mapped = {};
        let rowError = null;
        headers.forEach(h => { mapped[h] = colMap[h] ? ('' + (row[colMap[h]] ?? '')).trim() : ''; });
        config.required.forEach(r => { if (!mapped[r]) rowError = `Missing ${r}`; });

        if (_ldCategory === 'accounts' && mapped['Type'] && !config.validTypes.includes(mapped['Type'])) {
            rowError = `Invalid type: ${mapped['Type']}`;
        }

        let isDuplicate = false;
        const pk = (mapped[headers[0]] || '').toLowerCase();
        if (pk && existingNames.has(pk)) { isDuplicate = true; duplicates++; }

        _ldParsed.push({ data: mapped, error: rowError, duplicate: isDuplicate, rowNum: idx + 2 });
        if (rowError) _ldErrors++;
    });

    renderLdPreview(headers, duplicates);
}

function renderLdPreview(headers, duplicates) {
    $('ld-step-upload').classList.add('hidden');
    $('ld-step-preview').classList.remove('hidden');

    const validCount = _ldParsed.length - _ldErrors;
    $('ld-count-pill').textContent = `${_ldParsed.length} rows (${validCount} valid)`;
    const errPill = $('ld-err-pill');
    if (_ldErrors > 0 || duplicates > 0) {
        const parts = [];
        if (_ldErrors > 0) parts.push(`${_ldErrors} error${_ldErrors > 1 ? 's' : ''}`);
        if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''}`);
        errPill.textContent = parts.join(', ');
        errPill.style.display = '';
    } else { errPill.style.display = 'none'; }

    $('ld-preview-thead').innerHTML = '<tr><th>#</th>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '<th>Status</th></tr>';

    $('ld-preview-tbody').innerHTML = _ldParsed.map(p => {
        let cls = '', status = '<span style="color:var(--credit)">OK</span>';
        if (p.error) { cls = 'ld-row-err'; status = `<span style="color:var(--garnet)">${escapeHtml(p.error)}</span>`; }
        else if (p.duplicate) { cls = 'ld-row-dup'; status = '<span style="color:var(--amber)">Duplicate</span>'; }
        return `<tr class="${cls}"><td>${p.rowNum}</td>${headers.map(h => `<td>${escapeHtml(p.data[h])}</td>`).join('')}<td>${status}</td></tr>`;
    }).join('');

    if (validCount > 0) $('ld-import-btn').classList.remove('hidden');
}

async function executeLdImport() {
    const validRows = _ldParsed.filter(p => !p.error && !p.duplicate);
    if (validRows.length === 0) { showToast('No valid rows to import.', 'warning'); return; }

    const btn = $('ld-import-btn');
    setBtnLoading(btn, true);

    const companyRef = fbDb.collection('companies').doc(_ldCompanyId);
    const batchId = 'import_' + Date.now();

    try {
        let imported = 0;
        for (const row of validRows) {
            const d = row.data;
            switch (_ldCategory) {
                case 'accounts': {
                    const docRef = companyRef.collection('accounts').doc();
                    await docRef.set({
                        title: d['Title'], type: d['Type'],
                        openingBalance: parseFloat((d['Opening Balance'] || '0').toString().replace(/,/g, '')) || 0,
                        phone: d['Phone'] || '', city: d['City'] || '',
                        importBatch: batchId
                    });
                    break;
                }
                case 'items': {
                    const docRef = companyRef.collection('items').doc();
                    await docRef.set({
                        name: d['Item Name'],
                        purchasePrice: parseFloat((d['Purchase Price'] || '0').toString().replace(/,/g, '')) || 0,
                        salePrice: parseFloat((d['Sale Price'] || '0').toString().replace(/,/g, '')) || 0,
                        importBatch: batchId
                    });
                    break;
                }
                case 'rso': {
                    const userRef = companyRef.collection('users').doc();
                    await userRef.set({
                        fullName: d['Full Name'], role: 'rso',
                        mobile: d['Mobile'] || '', cnic: d['CNIC'] || '', area: d['Area'] || '',
                        importBatch: batchId
                    });
                    const accRef = companyRef.collection('accounts').doc('rsoacc_' + userRef.id);
                    await accRef.set({
                        title: d['Full Name'], type: 'Employee/RSO',
                        linkedUserId: userRef.id, openingBalance: 0,
                        importBatch: batchId
                    });
                    break;
                }
                case 'btl': {
                    const agentRef = companyRef.collection('btlAgents').doc();
                    await agentRef.set({
                        name: d['Agent Name'], mobile: d['Mobile'] || '',
                        cnic: d['CNIC'] || '', area: d['Area / Stall'] || '',
                        importBatch: batchId
                    });
                    const accRef = companyRef.collection('accounts').doc('btlacc_' + agentRef.id);
                    await accRef.set({
                        title: d['Agent Name'], type: 'Employee/BTL',
                        linkedUserId: agentRef.id, openingBalance: 0,
                        importBatch: batchId
                    });
                    break;
                }
                case 'rso_customers': {
                    const rsoName = (d['RSO Name'] || '').trim().toLowerCase();
                    const usersSnap = await companyRef.collection('users').where('role', '==', 'rso').get();
                    const rsoUser = usersSnap.docs.find(doc => (doc.data().fullName || '').toLowerCase() === rsoName);
                    if (!rsoUser) throw new Error(`RSO "${d['RSO Name']}" not found. Import RSO agents first.`);
                    const custRef = companyRef.collection('rsoCustomers').doc();
                    await custRef.set({
                        name: d['Customer Name'], shopName: d['Shop Name'] || '',
                        mobile: d['Mobile'] || '', area: d['Area'] || '',
                        rsoUserId: rsoUser.id,
                        creditLimit: parseFloat((d['Credit Limit'] || '0').toString().replace(/,/g, '')) || 0,
                        openingBalance: 0, customerType: 'Retailer', source: 'Office',
                        importBatch: batchId
                    });
                    break;
                }
            }
            imported++;
        }

        showToast(`Successfully imported ${imported} ${LD_CONFIGS[_ldCategory].title.toLowerCase()}.`, 'success');
        closeLoadDataPanel();
    } catch (err) {
        console.error('[LoadData]', err);
        showToast('Import failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
        setBtnLoading(btn, false);
    }
}
