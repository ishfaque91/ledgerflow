/**
 * LedgerFlow - Users module (Management > Add/Edit Users)
 *
 * Adding a new user here creates a REAL login for them (a genuine Firebase
 * Auth account, email + password), not just a cosmetic record. It uses a
 * secondary Firebase app instance to do this, since creating a user the
 * normal way would otherwise sign the admin out of their own session and
 * into the new person's account.
 *
 * Passwords are never stored in Firestore — Firebase Auth is the only
 * place a password lives. Editing an existing user can only change their
 * name and status here; email and password belong to Firebase Auth and
 * aren't editable from this screen (password changes go through the
 * person's own "Change Password" page instead).
 */

function renderUserList(searchTerm = '') {
    const tbody = $('user-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let users = lfGetAll(LF_KEYS.USERS);

    if (term) {
        users = users.filter(u =>
            (u.fullName || '').toLowerCase().includes(term) ||
            (u.username || '').toLowerCase().includes(term)
        );
    }

    users.sort((a, b) => a.fullName.localeCompare(b.fullName));
    $('user-count').textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;

    if (users.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No users yet — click "New User" to add your first one.</td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(u => `
        <tr>
            <td><strong>${escapeHtml(u.fullName)}</strong> <span class="type-badge">${u.role === 'owner' ? 'Owner' : 'Staff'}</span></td>
            <td>${escapeHtml(u.username)}</td>
            <td><span class="status-badge ${u.status === 'Inactive' ? 'is-inactive' : 'is-active'}">${escapeHtml(u.status || 'Active')}</span></td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openUserForm('${u.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteUser('${u.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openUserForm(id = null) {
    if (!hasRight('UTILITY', 'Add/Edit Users', id ? 'Edit' : 'Add')) {
        showToast(`You don't have permission to ${id ? 'edit' : 'add'} users.`, 'warning');
        return;
    }
    const modal = $('user-modal');
    const form = $('user-form');
    form.reset();
    $('user-id').value = '';
    $('user-auth-uid').value = '';
    $('user-username').readOnly = false;
    $('user-password').type = 'password';
    $('user-password').required = false;
    const toggleBtn = document.querySelector('#user-modal .password-toggle');
    if (toggleBtn) toggleBtn.textContent = 'Show';

    if (id) {
        const user = lfFindById(LF_KEYS.USERS, id);
        if (!user) { showToast('User not found.', 'error'); return; }

        $('user-modal-title').textContent = 'Edit User';
        $('user-id').value = user.id;
        $('user-auth-uid').value = user.linkedAuthUid || '';
        $('user-fullname').value = user.fullName;
        $('user-username').value = user.username;
        $('user-username').readOnly = true; // email is tied to their login, not editable here
        $('user-status').value = user.status || 'Active';
        $('user-password-field').classList.add('hidden'); // can't change someone else's password from here
    } else {
        $('user-modal-title').textContent = 'New User';
        $('user-password-field').classList.remove('hidden');
        $('user-password').required = true;
    }

    modal.classList.remove('hidden');
    setTimeout(() => $('user-fullname')?.focus(), 80);
}

function closeUserForm() {
    $('user-modal').classList.add('hidden');
}

function togglePasswordVisibility() {
    const input = $('user-password');
    const btn = document.querySelector('#user-modal .password-toggle');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Show' : 'Hide';
}

async function saveUser() {
    const id = $('user-id').value;
    const fullName = sanitizeInput($('user-fullname').value);
    const email = sanitizeInput($('user-username').value).toLowerCase();
    const status = $('user-status').value;
    const password = $('user-password').value;
    const saveBtn = $('user-save-btn');

    if (!hasRight('UTILITY', 'Add/Edit Users', id ? 'Edit' : 'Add')) {
        showToast(`You don't have permission to ${id ? 'edit' : 'add'} users.`, 'warning');
        return;
    }
    if (!fullName) { showToast('Please enter the full name.', 'warning'); $('user-fullname').focus(); return; }
    if (!email || !isValidEmail(email)) { showToast('Please enter a valid email.', 'warning'); $('user-username').focus(); return; }

    const duplicate = lfGetAll(LF_KEYS.USERS).find(u => u.username === email && u.id !== id);
    if (duplicate) { showToast('That email is already used by another user here.', 'error'); $('user-username').focus(); return; }

    if (!id && (!password || password.length < 6)) {
        showToast('Password must be at least 6 characters.', 'warning');
        $('user-password').focus();
        return;
    }

    setBtnLoading(saveBtn, true);

    try {
        if (!id) {
            // Brand-new staff login — create it on the secondary app so this
            // doesn't sign the admin out of their own session.
            const cred = await fbSecondaryAuth.createUserWithEmailAndPassword(email, password);
            const uid = cred.user.uid;
            await fbSecondaryAuth.signOut();

            await fbDb.collection('users').doc(uid).set({ companyId: currentCompanyId, email, fullName, role: 'staff' });
            await lfUpsert(LF_KEYS.USERS, { fullName, username: email, status, linkedAuthUid: uid, role: 'staff' });

            showToast('User created — they can log in with that email and password now.', 'success');
            logActivity('Created', 'User', fullName);
        } else {
            await lfUpsert(LF_KEYS.USERS, { id, fullName, username: email, status });
            showToast('User updated.', 'success');
            logActivity('Updated', 'User', fullName);
        }

        closeUserForm();
    } catch (e) {
        console.error(e);
        showToast(mapFirebaseError(e), 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteUser(id) {
    const user = lfFindById(LF_KEYS.USERS, id);
    if (!user) return;

    if (!hasRight('UTILITY', 'Add/Edit Users', 'Delete')) {
        showToast("You don't have permission to delete users.", 'warning');
        return;
    }

    if (fbAuth.currentUser && user.linkedAuthUid === fbAuth.currentUser.uid) {
        showToast("You can't remove your own account from here.", 'warning');
        return;
    }

    if (!confirm(`Remove "${user.fullName}"? Their login access is revoked immediately.`)) return;

    try {
        if (user.linkedAuthUid) {
            await fbDb.collection('users').doc(user.linkedAuthUid).delete();
        }
        await lfDelete(LF_KEYS.USERS, id);
        showToast('User removed — their login access has been revoked.', 'success');
        logActivity('Deleted', 'User', user.fullName);
    } catch (e) {
        console.error(e);
        showToast('Could not remove user — please try again.', 'error');
    }
}
