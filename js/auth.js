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

    try {
        const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;

        const companyDocRef = fbDb.collection('companies').doc();
        const companyId = companyDocRef.id;
        const today = new Date().toISOString().slice(0, 10);

        await companyDocRef.set({
            companyName, status: 'trial', signupDate: today, trialDays: 30,
            ownerUid: uid, ownerEmail: email, ownerPhone: phone,
            settings: { companyName, currencyLabel: 'Rs.', theme: 'light' },
            createdAt: new Date().toISOString()
        });

        await fbDb.collection('users').doc(uid).set({ companyId, email, fullName, role: 'owner' });

        await companyDocRef.collection('users').add({
            fullName, username: email, status: 'Active', linkedAuthUid: uid,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });

        showToast(`Welcome, ${companyName}! Your 30-day trial has started.`, 'success');

        // Everything now genuinely exists — safe to resolve and show the app ourselves.
        signupInProgress = false;
        await resolveCompanyAndShowApp(cred.user);
    } catch (err) {
        console.error('[Auth] Signup failed:', err);
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
            showToast("This login isn't linked to any company. Contact support.", 'error');
            await fbAuth.signOut();
            showLoginScreen();
            return;
        }

        const { companyId, fullName } = mapSnap.data();
        setCurrentCompany(companyId);
        $('active-user-chip').textContent = fullName || user.email;

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
    } catch (err) {
        console.error('[Auth] Resolving company failed:', err);
        showToast('Something went wrong loading your account.', 'error');
        showLoginScreen();
    }
}

function evaluateCompanyStatus() {
    const company = getCompanyDoc();
    if (!company || Object.keys(company).length === 0) return { ok: false, reason: 'notfound' };
    if (company.status === 'active') return { ok: true };
    if (company.status === 'suspended') return { ok: false, reason: 'suspended' };

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

    if (status.ok) {
        $('login-screen').classList.add('hidden');
        $('account-blocked-screen').classList.add('hidden');
        $('app-root').classList.remove('hidden');
        if (!dashboardShownThisSession) {
            dashboardShownThisSession = true;
            navigateTo('page-dashboard');
        }
        if (status.daysLeft !== undefined && status.daysLeft <= 5) {
            showToast(`Your trial ends in ${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'}.`, 'warning', 5000);
        }
        updateTrialBanner(status);
    } else {
        $('login-screen').classList.add('hidden');
        $('app-root').classList.add('hidden');
        $('account-blocked-screen').classList.remove('hidden');
        $('blocked-message').textContent = blockedMessageFor(status.reason);
    }
}

function updateTrialBanner(status) {
    const banner = $('trial-banner');
    if (status.daysLeft === undefined) {
        // Paid/active company — no need to nag them.
        banner.classList.add('hidden');
        return;
    }

    banner.classList.remove('hidden');
    banner.classList.toggle('is-urgent', status.daysLeft <= 5);
    $('trial-banner-badge').textContent = 'DEMO';

    const endDateLabel = status.trialEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    $('trial-banner-text').textContent =
        `This is a demo account — it expires on ${endDateLabel} (${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'} left). After that, the software will stop working until you subscribe.`;
}

function showRenewContact() {
    showToast(`To activate your subscription, contact ${VENDOR_CONTACT.name}: ${VENDOR_CONTACT.phone} / ${VENDOR_CONTACT.email}`, 'info', 8000);
}

function blockedMessageFor(reason) {
    const contact = `Contact ${VENDOR_CONTACT.name}: ${VENDOR_CONTACT.phone} / ${VENDOR_CONTACT.email}`;
    if (reason === 'suspended') return `Your account has been suspended. ${contact} to reactivate it.`;
    if (reason === 'trialExpired') return `Your demo period has ended. ${contact} to activate your subscription.`;
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
        'auth/network-request-failed': "Couldn't reach the server — check your internet connection."
    };
    return map[code] || 'Something went wrong. Please try again.';
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
    $('app-root').classList.add('hidden');
    $('account-blocked-screen').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-email').value = '';
    $('login-password').value = '';
    setTimeout(() => $('login-email')?.focus(), 50);
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
