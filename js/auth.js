/**
 * LedgerFlow - Authentication module (Firebase Auth version).
 *
 * How a company relates to a login:
 *   users/{uid}                     -> { companyId, email, fullName, role }   (top-level, one per login)
 *   companies/{companyId}           -> { companyName, status, signupDate, trialDays, settings, counters }
 *   companies/{companyId}/accounts  -> etc. (all the app's actual data)
 *
 * status is one of 'trial' | 'active' | 'suspended'. Only a trial company
 * with signupDate + trialDays still in the future (or an 'active' company)
 * gets past the gate below — everyone else sees the blocked screen instead
 * of the app. Firestore Security Rules block companies from writing their
 * own status field, so this can't be bypassed from the browser.
 *
 * signupInProgress guards against a race: Firebase can report "signed in"
 * a moment before we've finished creating that user's company/profile
 * documents. Without this guard, the auth listener would race ahead, find
 * nothing yet, and boot the person right back out mid-signup.
 */

let signupInProgress = false;
let dashboardShownThisSession = false;

// ==================== SIGN UP (new company, starts on Trial) ====================
async function handleSignup() {
    const companyName = sanitizeInput($('signup-company-name').value);
    const fullName = sanitizeInput($('signup-fullname').value);
    const email = sanitizeInput($('signup-email').value).toLowerCase();
    const phone = getDigitsOnly($('signup-phone').value);
    const password = $('signup-password').value;
    const confirmPassword = $('signup-confirm-password').value;
    const btn = $('signup-submit-btn');

    if (!companyName || !fullName || !email || !password) {
        showToast('Please fill in every field.', 'warning');
        return;
    }
    if (!isValidEmail(email)) { showToast('Please enter a valid email.', 'warning'); return; }
    if (phone && !isValidPakMobile(phone)) { showToast('Phone should be 10 digits after +92, starting with 3.', 'warning'); return; }
    if (password.length < 6) { showToast('Password must be at least 6 characters.', 'warning'); return; }
    if (password !== confirmPassword) { showToast("Passwords don't match.", 'warning'); return; }

    setBtnLoading(btn, true);
    signupInProgress = true; // tell the auth-state listener to stand down until we're fully done

    let cred = null;
    try {
        cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;

        // Reserve the company's document ID up front, without writing anything
        // yet. .doc() with no argument only generates an ID locally — no
        // network call — so we can reference it before the document exists.
        const companyDocRef = fbDb.collection('companies').doc();
        const companyId = companyDocRef.id;
        const today = new Date().toISOString().slice(0, 10);

        // ORDER MATTERS. users/{uid} is the document Security Rules read to
        // decide whether this login is allowed to touch companies/{companyId}.
        // Writing the company first meant the rules were evaluated against a
        // mapping that didn't exist yet, so the very first write of every
        // signup was denied. The mapping has to land first.
        await fbDb.collection('users').doc(uid).set({ companyId, email, fullName, role: 'owner' });

        await companyDocRef.set({
            companyName, status: 'trial', signupDate: today, trialDays: 30,
            ownerUid: uid, ownerEmail: email, ownerPhone: phone,
            settings: { companyName, currencyLabel: 'Rs.', theme: 'light' },
            createdAt: new Date().toISOString()
        });

        await companyDocRef.collection('users').add({
            fullName, username: email, status: 'Active', linkedAuthUid: uid, role: 'owner',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });

        showToast(`Welcome, ${companyName}! Your 30-day trial has started.`, 'success');

        // Everything now genuinely exists — safe to resolve and show the app ourselves.
        signupInProgress = false;
        setBtnLoading(btn, false);
        await resolveCompanyAndShowApp(cred.user);
    } catch (err) {
        console.error('[Auth] Signup failed:', err.code || '(no code)', err);

        // The Auth account is created before any of the Firestore writes, so a
        // failure here would otherwise leave a login with no company behind it:
        // retrying gives "email already in use", and logging in gives "not
        // linked to any company". That email would be unusable forever. Undo
        // the half-made account so the person can simply try again.
        if (cred && cred.user) {
            try {
                await cred.user.delete();
            } catch (cleanupErr) {
                console.error('[Auth] Could not roll back the half-created account:', cleanupErr);
                await fbAuth.signOut().catch(() => {});
            }
        }

        showToast(mapFirebaseError(err), 'error');
        setBtnLoading(btn, false);
    } finally {
        signupInProgress = false;
    }
}

// ==================== LOGIN ====================
async function handleLogin() {
    const email = sanitizeInput($('login-email').value).toLowerCase();
    const password = $('login-password').value;
    const btn = $('login-submit-btn');

    if (!email || !password) { showToast('Enter both email and password.', 'warning'); return; }

    setBtnLoading(btn, true);
    try {
        await fbAuth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged below picks this up automatically.
    } catch (err) {
        console.error('[Auth] Login failed:', err);
        showToast(mapFirebaseError(err), 'error');
        setBtnLoading(btn, false);
    }
}

function handleLogout() {
    fbAuth.signOut();
    clearCurrentCompany();
    dashboardShownThisSession = false;
    showLoginScreen();
    showToast('Logged out.', 'info', 1500);
}

// ==================== RESOLVE COMPANY + GATE ACCESS ====================
async function resolveCompanyAndShowApp(user) {
    try {
        const mapSnap = await fbDb.collection('users').doc(user.uid).get();
        if (!mapSnap.exists) {
            // Usually an account left behind by a signup that failed part-way
            // before the rollback in handleSignup() existed. The login is real
            // but has no company, so it can never get in — it has to be
            // removed from Firebase Console > Authentication > Users, after
            // which that email is free to sign up again.
            showToast("This login was never finished setting up and has no company. Contact support to have it removed so you can sign up again.", 'error', 7000);
            await fbAuth.signOut();
            showLoginScreen();
            return;
        }

        const { companyId, fullName } = mapSnap.data();
        setCurrentCompany(companyId);
        $('active-user-chip').textContent = fullName || user.email;
        $('account-user-email').textContent = user.email || '—';

        watchCompanyDoc(() => {
            applyTheme(lfGetSettings().theme);
            renderBranding();
            evaluateAndGateAccess();
        });

        watchCollection(LF_KEYS.ACCOUNTS, () => renderAccountList());
        watchCollection(LF_KEYS.ITEMS, () => renderItemList());
        watchCollection(LF_KEYS.USERS, () => { renderUserList(); populateRightsUserPicker(); });
        watchCollection(LF_KEYS.RIGHTS, () => renderRightsTable());
        watchCollection(LF_KEYS.INVOICES, () => Object.keys(INVOICE_CONFIG).forEach(t => renderInvoiceList(t)));
        watchCollection(LF_KEYS.VOUCHERS, () => ['BankReceipt', 'BankPayment', 'PettyCash', 'Journal'].forEach(t => renderVoucherList(t)));
        watchCollection(LF_KEYS.EDIT_LOG, () => renderEditLog());

        // These three were previously never watched at all — meaning every
        // screen that reads them (Account Ledger, Cash Book, Trial Balance,
        // Balance Sheet, P&L, Load Ledger, Item Ledger, Stock Report, and the
        // Dashboard's Load Balance) always showed empty, no matter what had
        // actually been posted to the database.
        watchCollection(LF_KEYS.ACCOUNT_LEDGER, () => {
            renderAccountLedgerReport();
            renderCashBookReport();
            renderAccountBalances();
            renderTrialBalance();
            renderBalanceSheet();
            renderProfitAndLoss();
        });
        watchCollection(LF_KEYS.LOAD_LEDGER, () => {
            renderLoadLedgerReport();
            renderDashboard();
        });
        watchCollection(LF_KEYS.ITEM_LEDGER, () => {
            renderItemLedgerReport();
            renderStockReport();
        });
    } catch (err) {
        console.error('[Auth] Resolving company failed:', err);
        showToast('Something went wrong loading your account.', 'error');
        showLoginScreen();
    }
}

function evaluateCompanyStatus() {
    const company = getCompanyDoc();
    if (!company || Object.keys(company).length === 0) return { ok: false, reason: 'notfound' };
    if (company.status === 'suspended') return { ok: false, reason: 'suspended' };

    if (company.status === 'active') {
        if (!company.activeUntil) return { ok: true }; // legacy/no-expiry active company
        const end = new Date(company.activeUntil);
        const today = new Date();
        if (today > end) return { ok: false, reason: 'subscriptionExpired' };
        return { ok: true, daysLeft: Math.ceil((end - today) / (1000 * 60 * 60 * 24)), trialEnd: end, isPaid: true };
    }

    // status === 'trial'
    const start = new Date(company.signupDate);
    const end = new Date(start);
    end.setDate(end.getDate() + (company.trialDays || 30));
    const today = new Date();

    if (today > end) return { ok: false, reason: 'trialExpired' };
    return { ok: true, daysLeft: Math.ceil((end - today) / (1000 * 60 * 60 * 24)), trialEnd: end };
}

// Fill in your own real contact details here — shown to every client
// company when they click "Renew Now" on an expiring trial.
const VENDOR_CONTACT = {
    name: 'Ishfaque',
    phone: '+92 333 2392852',
    email: 'you@example.com'
};

function evaluateAndGateAccess() {
    const status = evaluateCompanyStatus();
    $('app-loading-screen')?.classList.add('hidden');

    if (status.ok) {
        $('login-screen').classList.add('hidden');
        $('account-blocked-screen').classList.add('hidden');
        $('app-root').classList.remove('hidden');
        if (!dashboardShownThisSession) {
            dashboardShownThisSession = true;
            navigateTo(resumeLastPageId());
        }
        if (status.daysLeft !== undefined && status.daysLeft <= 5) {
            const noun = status.isPaid ? 'subscription' : 'trial';
            showToast(`Your ${noun} ends in ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'}.`, 'warning', 5000);
        }
        updateTrialBanner(status);
        updateDemoTag(status);
    } else {
        $('login-screen').classList.add('hidden');
        $('app-root').classList.add('hidden');
        $('account-blocked-screen').classList.remove('hidden');
        $('blocked-message').textContent = blockedMessageFor(status.reason);
    }
}

function updateTrialBanner(status) {
    const banner = $('trial-banner');

    // Only nag in the final stretch — 5 days or fewer remaining — for both
    // demo trials and paid subscriptions. Otherwise, stay out of the way.
    if (status.daysLeft === undefined || status.daysLeft > 5) {
        banner.classList.add('hidden');
        return;
    }

    banner.classList.remove('hidden');
    banner.classList.toggle('is-urgent', status.daysLeft <= 2);

    const endDateLabel = status.trialEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    if (status.isPaid) {
        $('trial-banner-badge').textContent = 'SUBSCRIPTION';
        $('trial-banner-text').textContent =
            `Your subscription ends in ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'} (${endDateLabel}). Renew soon to avoid any interruption.`;
    } else {
        $('trial-banner-badge').textContent = 'DEMO';
        $('trial-banner-text').textContent =
            `Your demo ends in ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'} (${endDateLabel}). After that, the software will stop working until you subscribe.`;
    }
}

// A small, always-visible "Demo Account" label under the company name in the
// top bar — present for the whole trial, gone the moment it's activated.
function updateDemoTag(status) {
    const tag = $('demo-account-tag');
    if (!tag) return;
    const isDemo = status.ok && !status.isPaid && status.daysLeft !== undefined;
    tag.classList.toggle('hidden', !isDemo);
}

function showRenewContact() {
    showToast(`To activate your subscription, contact ${VENDOR_CONTACT.name}: ${VENDOR_CONTACT.phone} / ${VENDOR_CONTACT.email}`, 'info', 8000);
}

// Always-visible status readout on the Settings page — unlike the banner,
// this doesn't wait until 5 days are left; it's a permanent reference.
function renderAccountStatusCard() {
    const label = $('account-status-label');
    if (!label) return; // Settings page not in the DOM yet on first load — fine, it's called again when opened

    const status = evaluateCompanyStatus();
    const company = getCompanyDoc();

    if (company.status === 'suspended') {
        label.textContent = 'Suspended';
        $('account-status-days-label').textContent = ' ';
        $('account-status-days-value').textContent = '—';
        return;
    }

    if (status.daysLeft === undefined) {
        // Active with no expiry set (legacy) or something unusual
        label.textContent = company.status === 'active' ? 'Active' : 'Unknown';
        $('account-status-days-label').textContent = ' ';
        $('account-status-days-value').textContent = '—';
        return;
    }

    const daysLeft = Math.max(status.daysLeft, 0);
    if (status.isPaid) {
        label.textContent = 'Active (paid)';
        $('account-status-days-label').textContent = 'Days remaining';
        $('account-status-days-value').textContent = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    } else {
        label.textContent = 'Demo Account';
        $('account-status-days-label').textContent = 'Days remaining';
        $('account-status-days-value').textContent = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    }
}

function blockedMessageFor(reason) {
    const contact = `Contact ${VENDOR_CONTACT.name}: ${VENDOR_CONTACT.phone} / ${VENDOR_CONTACT.email}`;
    if (reason === 'suspended') return `Your account has been suspended. ${contact} to reactivate it.`;
    if (reason === 'trialExpired') return `Your demo period has ended. ${contact} to activate your subscription.`;
    if (reason === 'subscriptionExpired') return `Your subscription period has ended. ${contact} to renew it.`;
    return `We couldn't find your company's account. ${contact} for support.`;
}

// ==================== FRIENDLY ERROR MESSAGES ====================
function mapFirebaseError(err) {
    const code = err && err.code;
    const map = {
        'auth/email-already-in-use': 'An account with this email already exists — try logging in instead.',
        'auth/invalid-email': "That email address doesn't look right.",
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/user-not-found': 'No account found with that email.',
        'auth/wrong-password': 'Incorrect email or password.',
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/too-many-requests': 'Too many attempts — please wait a moment and try again.',
        'auth/network-request-failed': "Couldn't reach the server — check your internet connection.",

        // Setup problems. These are the ones that used to fall through to the
        // generic message, which made a broken Firebase project look identical
        // to a mistyped password.
        'auth/operation-not-allowed': 'Sign-up is switched off for this project. Enable Email/Password in Firebase Console > Authentication > Sign-in method.',
        'auth/admin-restricted-operation': 'New sign-ups are currently blocked in Firebase Console (Authentication > Settings > User actions).',
        'auth/unauthorized-domain': 'This web address is not on the Firebase authorised domains list. Add it in Firebase Console > Authentication > Settings.',
        'auth/operation-not-supported-in-this-environment': 'Open the app over http:// or https:// — sign-up cannot work from a file:// page opened directly from a folder.',

        // Firestore rejections (thrown by the profile/company writes, not Auth).
        'permission-denied': 'Your account was created but your company record was blocked by the database rules. Nothing was saved — please contact support.',
        'unavailable': "Couldn't reach the database — check your internet connection and try again."
    };
    if (map[code]) return map[code];
    return `Something went wrong. Please try again.${code ? ` (${code})` : ''}`;
}

// ==================== SCREEN SWITCHING (Login <-> Sign Up) ====================
function showLoginForm() {
    $('login-form-panel').classList.remove('hidden');
    $('signup-form-panel').classList.add('hidden');
}
function showSignupForm() {
    $('login-form-panel').classList.add('hidden');
    $('signup-form-panel').classList.remove('hidden');
}

function showLoginScreen() {
    $('app-loading-screen')?.classList.add('hidden');
    $('app-root').classList.add('hidden');
    $('account-blocked-screen').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-email').value = '';
    $('login-password').value = '';
    setBtnLoading($('login-submit-btn'), false);
    setBtnLoading($('signup-submit-btn'), false);
    resetLoginBranding();
    setTimeout(() => $('login-email')?.focus(), 50);
}

// renderBranding() (utility.js) repaints the login screen with whichever
// company was last signed in — including their own logo-fallback initial,
// which destroys the LedgerFlow mark's <svg> by overwriting it with plain
// text. Once signed out there's no company in scope, so put the generic
// LedgerFlow identity back.
function resetLoginBranding() {
    $('login-company-name').textContent = 'LedgerFlow';
    $('login-logo-img').classList.add('hidden');
    const fallback = $('login-logo-fallback');
    fallback.innerHTML = '<svg class="lf-mark-icon" viewBox="0 0 24 24"><use href="#lf-logo-mark"/></svg>';
    fallback.classList.remove('hidden');
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    fbAuth.onAuthStateChanged(user => {
        if (signupInProgress) return; // handleSignup() will resolve things itself once ready

        if (user) {
            resolveCompanyAndShowApp(user);
        } else {
            clearCurrentCompany();
            dashboardShownThisSession = false;
            showLoginScreen();
        }
    });

    $('login-password')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
});
