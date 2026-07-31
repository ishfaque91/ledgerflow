/**
 * LedgerFlow - Utility module (Backup Data / Change Password / Settings).
 */

// ==================== THEME ====================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

function toggleTheme() {
    const settings = lfGetSettings();
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    lfSaveSettings(settings);
    applyTheme(settings.theme);
    const checkbox = $('settings-dark-mode');
    if (checkbox) checkbox.checked = settings.theme === 'dark';
    showToast(settings.theme === 'dark' ? 'Dark mode on.' : 'Light mode on.', 'info', 1500);
}

function onDarkModeCheckboxChange() {
    applyTheme($('settings-dark-mode').checked ? 'dark' : 'light');
}

// Apply the saved theme immediately, before the rest of the app renders
applyTheme(lfGetSettings().theme);

// ==================== BRANDING (topbar + login screen) ====================
function renderBranding() {
    const settings = lfGetSettings();
    const name = settings.companyName || 'LedgerFlow';
    const initial = settings.companyName ? settings.companyName.charAt(0).toUpperCase() : 'L';

    $('brand-name-text').textContent = name;
    $('login-company-name').textContent = name;

    [['brand-logo-img', 'brand-logo-fallback'], ['login-logo-img', 'login-logo-fallback']].forEach(([imgId, fallbackId]) => {
        const img = $(imgId);
        const fallback = $(fallbackId);
        if (settings.companyLogo) {
            img.src = settings.companyLogo;
            img.classList.remove('hidden');
            fallback.classList.add('hidden');
        } else {
            img.classList.add('hidden');
            fallback.classList.remove('hidden');
            fallback.textContent = initial;
        }
    });
}

// ==================== LOGO UPLOAD ====================
function handleLogoUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose an image file.', 'warning'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        $('settings-logo-preview').src = dataUrl;
        $('settings-logo-preview').classList.remove('hidden');
        $('settings-logo-fallback').classList.add('hidden');
        $('settings-form').dataset.pendingLogo = dataUrl;
    };
    reader.readAsDataURL(file);
}

function clearLogo() {
    $('settings-logo-preview').classList.add('hidden');
    $('settings-logo-fallback').classList.remove('hidden');
    $('settings-form').dataset.pendingLogo = '';
    $('settings-logo-input').value = '';
}

// ==================== SETTINGS ====================
function initSettingsPage() {
    renderAccountStatusCard();
    const settings = lfGetSettings();

    $('settings-company-name').value = settings.companyName;
    $('settings-company-phone').value = settings.companyPhone || '';
    $('settings-company-email').value = settings.companyEmail || '';
    $('settings-company-city').value = settings.companyCity || '';
    $('settings-company-ntn').value = settings.companyNTN || '';
    $('settings-company-gst').value = settings.companyGST || '';
    $('settings-company-address').value = settings.companyAddress || '';
    $('settings-currency-label').value = settings.currencyLabel;
    $('settings-dark-mode').checked = settings.theme === 'dark';

    $('settings-form').dataset.pendingLogo = settings.companyLogo || '';
    const initial = settings.companyName ? settings.companyName.charAt(0).toUpperCase() : 'L';
    if (settings.companyLogo) {
        $('settings-logo-preview').src = settings.companyLogo;
        $('settings-logo-preview').classList.remove('hidden');
        $('settings-logo-fallback').classList.add('hidden');
    } else {
        $('settings-logo-preview').classList.add('hidden');
        $('settings-logo-fallback').classList.remove('hidden');
        $('settings-logo-fallback').textContent = initial;
    }
}

function saveSettings() {
    const saveBtn = $('settings-save-btn');

    const companyPhone = getDigitsOnly($('settings-company-phone').value);
    const companyEmail = sanitizeInput($('settings-company-email').value);

    if (companyPhone && !isValidPakMobile(companyPhone)) {
        showToast('Company phone should be 10 digits after +92, starting with 3.', 'warning');
        return;
    }
    if (companyEmail && !isValidEmail(companyEmail)) {
        showToast('Please enter a valid company email.', 'warning');
        return;
    }

    setBtnLoading(saveBtn, true);

    const settings = {
        companyName: sanitizeInput($('settings-company-name').value),
        companyLogo: $('settings-form').dataset.pendingLogo || '',
        companyPhone, companyEmail,
        companyCity: sanitizeInput($('settings-company-city').value),
        companyNTN: sanitizeInput($('settings-company-ntn').value),
        companyGST: sanitizeInput($('settings-company-gst').value),
        companyAddress: sanitizeInput($('settings-company-address').value),
        currencyLabel: sanitizeInput($('settings-currency-label').value) || 'Rs.',
        theme: $('settings-dark-mode').checked ? 'dark' : 'light'
    };

    lfSaveSettings(settings);
    applyTheme(settings.theme);
    renderBranding();

    showToast('Settings saved.', 'success');
    setBtnLoading(saveBtn, false);
}

// ==================== CHANGE PASSWORD ====================
function initChangePasswordPage() {
    $('change-password-form').reset();
    const user = fbAuth.currentUser;
    $('cp-current-user-email').textContent = user ? user.email : '—';
}

async function saveNewPassword() {
    const current = $('cp-current').value;
    const next = $('cp-new').value;
    const confirmPwd = $('cp-confirm').value;
    const saveBtn = $('change-password-btn');
    const user = fbAuth.currentUser;

    if (!user) { showToast('You need to be logged in.', 'error'); return; }
    if (!current) { showToast('Enter your current password.', 'warning'); $('cp-current').focus(); return; }
    if (!next || next.length < 6) { showToast('New password must be at least 6 characters.', 'warning'); $('cp-new').focus(); return; }
    if (next !== confirmPwd) { showToast("New password and confirmation don't match.", 'warning'); $('cp-confirm').focus(); return; }

    setBtnLoading(saveBtn, true);

    try {
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(next);
        showToast('Password updated.', 'success');
        $('change-password-form').reset();
    } catch (e) {
        console.error(e);
        showToast(mapFirebaseError(e), 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

// ==================== BACKUP / RESTORE ====================
function renderBackupSummary() {
    $('backup-accounts-count').textContent = lfGetAll(LF_KEYS.ACCOUNTS).length;
    $('backup-items-count').textContent = lfGetAll(LF_KEYS.ITEMS).length;
    $('backup-invoices-count').textContent = lfGetAll(LF_KEYS.INVOICES).length;
    $('backup-vouchers-count').textContent = lfGetAll(LF_KEYS.VOUCHERS).length;
}

function exportBackup() {
    const backup = { _meta: { app: 'LedgerFlow', exportedAt: new Date().toISOString() } };

    // The real data lives in Firestore (mirrored into the in-memory cache
    // lfGetAll reads from) — this app has never used localStorage for
    // records, so reading from it here only ever produced an empty backup.
    Object.values(LF_KEYS).forEach(key => {
        backup[key] = lfGetAll(key);
    });

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LedgerFlow-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast('Backup downloaded.', 'success');
}

function handleRestoreFile(input) {
    const file = input.files[0];
    if (!file) return;

    if (!confirm('This replaces everything currently in LedgerFlow with the contents of this file. This cannot be undone. Continue?')) {
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        (async () => {
            try {
                const data = JSON.parse(event.target.result);
                if (!data || typeof data !== 'object') throw new Error('Not an object');

                showToast('Restoring — this can take a moment, please stay on this page…', 'info', 6000);

                // A true replace: wipe each collection's current Firestore
                // documents, then write back exactly what the backup file
                // has — under the SAME ids, so cross-references between
                // invoices/vouchers and their ledger entries (which point at
                // each other by id) stay intact.
                for (const key of Object.values(LF_KEYS)) {
                    const existing = lfGetAll(key);
                    await Promise.all(existing.map(record => lfDelete(key, record.id)));

                    const incoming = Array.isArray(data[key]) ? data[key] : [];
                    await Promise.all(
                        incoming.filter(record => record && record.id).map(record => lfUpsert(key, { ...record }))
                    );
                }

                showToast('Backup restored — reloading…', 'success');
                setTimeout(() => location.reload(), 900);
            } catch (err) {
                console.error('[Backup] Restore failed:', err);
                showToast("That file doesn't look like a valid LedgerFlow backup, or the restore didn't fully complete.", 'error', 6000);
            } finally {
                input.value = '';
            }
        })();
    };
    reader.readAsText(file);
}
