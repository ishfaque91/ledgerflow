let companiesCache = [];
let companiesUnsub = null;
let currentDetailId = null;

const WIPE_COLLECTIONS = [
    'ACCOUNTS', 'ITEMS', 'USERS', 'RIGHTS', 'INVOICES',
    'ACCOUNT_LEDGER', 'LOAD_LEDGER', 'ITEM_LEDGER',
    'VOUCHERS', 'EDIT_LOG', 'SETTINGS',
    'RSO_CUSTOMERS', 'RSO_SALES', 'RSO_RETURNS',
    'RSO_RECOVERIES', 'RSO_LOADS', 'RSO_DEPOSITS'
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
            <div class="action-card-title">Remove Company</div>
            <div class="action-card-desc">Remove from admin list only</div>
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
    if (!confirm(`Remove ${c.companyName} from the admin list?\n\nThis only removes the company record — their login and data remain in Firebase.`)) return;
    try {
        await fbDb.collection('companies').doc(id).delete();
        showToast('Company record removed.', 'success');
        showListView();
    } catch (e) {
        console.error(e);
        showToast('Could not delete — please try again.', 'error');
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
            await deleteSubcollection(companyRef, colName);
            completed++;
            $('wipe-progress-fill').style.width = `${Math.round((completed / WIPE_COLLECTIONS.length) * 100)}%`;
        }

        $('wipe-progress-text').textContent = 'All data wiped successfully.';
        showToast(`All data wiped for ${c.companyName}.`, 'success');
        setTimeout(() => closeWipeModal(), 1200);
    } catch (e) {
        console.error('[Wipe] Error:', e);
        $('wipe-progress-text').textContent = `Error: ${e.message}`;
        showToast('Wipe failed — some data may remain. Try again.', 'error');
    } finally {
        setBtnLoading(btn, false);
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
});
