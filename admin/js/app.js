/**
 * LedgerFlow Super Admin - Firebase-backed logic.
 *
 * Login is real Firebase Authentication (same project as the client app).
 * After logging in, we check that this user's uid has a document in the
 * top-level `superAdmins` collection — that's what actually grants access
 * (both here in the UI, and for real in Firestore's Security Rules, which
 * is what actually stops anyone else from reading or changing companies).
 *
 * Companies are created only through the client app's own self-signup —
 * this panel reads and manages status on the top-level `companies`
 * collection, but never creates new ones from scratch (a company created
 * here wouldn't have a matching login for anyone to actually use).
 */

let companiesCache = [];
let companiesUnsub = null;

function setBtnLoading(btn, isLoading) {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.querySelector('.btn-label')?.classList.toggle('hidden', isLoading);
    btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !isLoading);
}

// ==================== TRIAL / STATUS CALCULATIONS ====================
function getTrialEndDate(company) {
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
    if (company.status === 'active') return { label: 'Active', cls: 'is-active' };
    if (company.status === 'suspended') return { label: 'Suspended', cls: 'is-suspended' };
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

// ==================== LIST / RENDER ====================
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

    const tbody = $('sap-table-body');
    if (companies.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No companies yet — they'll appear here automatically once someone signs up.</td></tr>`;
    } else {
        tbody.innerHTML = companies.map(c => {
            const status = getStatusDisplay(c);
            const trialEnd = getTrialEndDate(c).toISOString().slice(0, 10);
            return `
            <tr>
                <td><strong>${escapeHtml(c.companyName)}</strong>${c.planLabel ? ' <span class="type-badge">' + escapeHtml(c.planLabel) + '</span>' : ''}</td>
                <td>${escapeHtml(c.ownerEmail) || '-'}${c.ownerPhone ? '<br><span class="hint">+92 ' + escapeHtml(c.ownerPhone) + '</span>' : ''}</td>
                <td><span class="status-badge ${status.cls}">${status.label}</span></td>
                <td>${escapeHtml(c.signupDate)}</td>
                <td>${trialEnd}</td>
                <td>
                    <div class="row-actions">
                        ${renderStatusActionButtons(c)}
                        <button class="btn-outline-text" onclick="openCompanyForm('${c.id}')">Edit</button>
                        <button class="btn-danger-text" onclick="deleteCompany('${c.id}')">Delete</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    renderSummary(companiesCache);
    renderExpiringBanner(companiesCache);
}

function renderStatusActionButtons(c) {
    if (c.status === 'active') {
        return `<button class="btn-danger-text" onclick="suspendCompany('${c.id}')">Suspend</button>`;
    }
    let html = `<button class="btn-outline-text" onclick="activateCompany('${c.id}')">Activate</button>`;
    if (c.status !== 'suspended') {
        html += `<button class="btn-outline-text" onclick="extendTrial('${c.id}')">+30d</button>`;
    }
    return html;
}

function renderSummary(companies) {
    $('sap-count-total').textContent = companies.length;
    $('sap-count-trial').textContent = companies.filter(c => c.status === 'trial').length;
    $('sap-count-active').textContent = companies.filter(c => c.status === 'active').length;
    $('sap-count-suspended').textContent = companies.filter(c => c.status === 'suspended').length;
}

function renderExpiringBanner(companies) {
    const soon = companies
        .filter(c => c.status === 'trial')
        .map(c => ({ c, daysLeft: getDaysLeft(c) }))
        .filter(x => x.daysLeft <= 5);

    const banner = $('sap-expiring-banner');
    if (soon.length === 0) { banner.classList.add('hidden'); return; }

    banner.classList.remove('hidden');
    soon.sort((a, b) => a.daysLeft - b.daysLeft);
    $('sap-expiring-list').innerHTML = soon.map(({ c, daysLeft }) => `
        <div class="statement-row">
            <span>${escapeHtml(c.companyName)}</span>
            <span class="${daysLeft < 0 ? 'days-left-tag is-soon' : 'days-left-tag'}">${daysLeft < 0 ? Math.abs(daysLeft) + 'd overdue' : daysLeft + 'd left'}</span>
        </div>
    `).join('');
}

// ==================== STATUS ACTIONS ====================
async function activateCompany(id) {
    try {
        await fbDb.collection('companies').doc(id).update({ status: 'active' });
        showToast('Company activated.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not activate — please try again.', 'error');
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
    if (!confirm(`Delete ${c.companyName}? This removes their company record permanently (their login and data remain — this only removes them from this admin list).`)) return;
    try {
        await fbDb.collection('companies').doc(id).delete();
        showToast('Company record removed.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete — please try again.', 'error');
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
        // onAuthStateChanged below picks this up and checks Super Admin access.
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
    $('app-root').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-email').value = '';
    $('login-password').value = '';
    setTimeout(() => $('login-email')?.focus(), 50);
}

async function showApp(user) {
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
