/**
 * TeleFlow - SIM Activation & Commission Module
 *
 * Tracks SIM distribution, activation claims, real/non-real verification,
 * commission calculation, and BVS device assignment.
 *
 * No double-entry accounting — commissions only hit the books when paid
 * via an existing Cash Voucher / Bank Payment.
 */

// ==================== RSO LOAD LEDGER ====================
function initRsoLoadLedgerPage() {
    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-ll-rso');
        const sel = $('rso-ll-rso');
        if (sel) {
            const opts = sel.querySelectorAll('option');
            if (opts.length > 1 && !sel.value) sel.value = '';
        }
        $('rso-ll-rso-field').style.display = '';
    } else {
        $('rso-ll-rso-field').style.display = 'none';
    }
    renderRsoLoadLedgerReport();
}

function _buildRsoLoadLedgerEntries(rsoUserId) {
    const entries = [];

    let loads = lfGetAll(LF_KEYS.RSO_LOADS);
    if (rsoUserId) loads = loads.filter(l => l.rsoUserId === rsoUserId);
    loads.forEach(l => {
        const totalQty = (l.items || []).reduce((s, r) => s + (r.qty || 0), 0);
        entries.push({
            date: l.date, type: 'Stock In', ref: l.number || '',
            note: 'Stock received from company',
            qtyIn: totalQty, qtyOut: 0,
            amountChange: l.grandTotal || 0
        });
    });

    let sales = lfGetAll(LF_KEYS.RSO_SALES);
    if (rsoUserId) sales = sales.filter(s => s.rsoUserId === rsoUserId);
    sales.forEach(s => {
        const totalQty = (s.items || []).reduce((sum, r) => sum + (r.qty || 0), 0) + (s.loadQty || 0);
        entries.push({
            date: s.date, type: 'Sale', ref: s.number || '',
            note: `Sold to ${s.customerName || ''}`,
            qtyIn: 0, qtyOut: totalQty,
            amountChange: s.grandTotal || 0
        });
    });

    let returns = lfGetAll(LF_KEYS.RSO_RETURNS);
    if (rsoUserId) returns = returns.filter(r => r.rsoUserId === rsoUserId);
    returns.forEach(r => {
        const totalQty = (r.items || []).reduce((sum, row) => sum + (row.qty || 0), 0);
        entries.push({
            date: r.date, type: 'Return', ref: r.number || '',
            note: `Return from ${r.customerName || ''}`,
            qtyIn: totalQty, qtyOut: 0,
            amountChange: r.grandTotal || 0
        });
    });

    entries.sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        if (d !== 0) return d;
        const order = { 'Stock In': 0, 'Return': 1, 'Sale': 2 };
        return (order[a.type] || 9) - (order[b.type] || 9);
    });

    return entries;
}

function renderRsoLoadLedgerReport() {
    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-ll-rso')?.value || '');
    const dateFrom = $('rso-ll-date-from')?.value || '';
    const dateTo = $('rso-ll-date-to')?.value || '';

    const allEntries = _buildRsoLoadLedgerEntries(rsoUserId);

    let opening = 0, openingAmt = 0;
    const within = [];
    allEntries.forEach(e => {
        const net = e.qtyIn - e.qtyOut;
        if (dateFrom && e.date < dateFrom) { opening += net; openingAmt += (e.amountChange || 0) * (net >= 0 ? 1 : -1); return; }
        if (dateTo && e.date > dateTo) return;
        within.push(e);
    });

    let running = opening;
    const rows = within.map(e => {
        running += e.qtyIn - e.qtyOut;
        return { ...e, runningBalance: running };
    });

    $('rso-ll-opening').textContent = opening.toLocaleString('en-US');
    $('rso-ll-closing').textContent = (rows.length ? rows[rows.length - 1].runningBalance : opening).toLocaleString('en-US');

    const tbody = $('rso-load-ledger-table-body');
    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No stock movement in this range.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(e => `
        <tr>
            <td>${escapeHtml(e.date)}</td>
            <td><span class="type-badge">${escapeHtml(e.type)}</span></td>
            <td>${escapeHtml(e.ref)}</td>
            <td>${escapeHtml(e.note) || '-'}</td>
            <td class="num">${e.qtyIn > 0 ? e.qtyIn.toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.qtyOut > 0 ? e.qtyOut.toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.runningBalance.toLocaleString('en-US')}</td>
            <td class="num">${formatCurrency(e.amountChange || 0)}</td>
        </tr>
    `).join('');
}

// ==================== RSO ITEM LEDGER ====================
function initRsoItemLedgerPage() {
    const select = $('rso-il-item');
    const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = '<option value="">All Items</option>' +
        items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');

    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-il-rso');
        $('rso-il-rso-field').style.display = '';
    } else {
        $('rso-il-rso-field').style.display = 'none';
    }
    renderRsoItemLedgerReport();
}

function _buildRsoItemLedgerEntries(rsoUserId, itemId) {
    const entries = [];

    let loads = lfGetAll(LF_KEYS.RSO_LOADS);
    if (rsoUserId) loads = loads.filter(l => l.rsoUserId === rsoUserId);
    loads.forEach(l => {
        (l.items || []).forEach(row => {
            if (itemId && row.itemId !== itemId) return;
            entries.push({
                date: l.date, type: 'Stock In', ref: l.number || '',
                itemName: row.itemName || '',
                note: 'Received from company',
                qtyIn: row.qty || 0, qtyOut: 0
            });
        });
    });

    let sales = lfGetAll(LF_KEYS.RSO_SALES);
    if (rsoUserId) sales = sales.filter(s => s.rsoUserId === rsoUserId);
    sales.forEach(s => {
        (s.items || []).forEach(row => {
            if (itemId && row.itemId !== itemId) return;
            entries.push({
                date: s.date, type: 'Sale', ref: s.number || '',
                itemName: row.itemName || '',
                note: `Sold to ${s.customerName || ''}`,
                qtyIn: 0, qtyOut: row.qty || 0
            });
        });
    });

    let returns = lfGetAll(LF_KEYS.RSO_RETURNS);
    if (rsoUserId) returns = returns.filter(r => r.rsoUserId === rsoUserId);
    returns.forEach(r => {
        (r.items || []).forEach(row => {
            if (itemId && row.itemId !== itemId) return;
            entries.push({
                date: r.date, type: 'Return', ref: r.number || '',
                itemName: row.itemName || '',
                note: `Return from ${r.customerName || ''}`,
                qtyIn: row.qty || 0, qtyOut: 0
            });
        });
    });

    entries.sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        if (d !== 0) return d;
        const order = { 'Stock In': 0, 'Return': 1, 'Sale': 2 };
        return (order[a.type] || 9) - (order[b.type] || 9);
    });

    return entries;
}

function renderRsoItemLedgerReport() {
    const itemId = $('rso-il-item')?.value || '';
    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-il-rso')?.value || '');
    const dateFrom = $('rso-il-date-from')?.value || '';
    const dateTo = $('rso-il-date-to')?.value || '';

    const allEntries = _buildRsoItemLedgerEntries(rsoUserId, itemId);

    let opening = 0;
    const within = [];
    allEntries.forEach(e => {
        const net = e.qtyIn - e.qtyOut;
        if (dateFrom && e.date < dateFrom) { opening += net; return; }
        if (dateTo && e.date > dateTo) return;
        within.push(e);
    });

    let running = opening;
    const rows = within.map(e => {
        running += e.qtyIn - e.qtyOut;
        return { ...e, runningBalance: running };
    });

    $('rso-il-opening').textContent = opening.toLocaleString('en-US');
    $('rso-il-closing').textContent = (rows.length ? rows[rows.length - 1].runningBalance : opening).toLocaleString('en-US');

    const tbody = $('rso-item-ledger-table-body');
    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No item movement in this range.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(e => `
        <tr>
            <td>${escapeHtml(e.date)}</td>
            <td><span class="type-badge">${escapeHtml(e.type)}</span></td>
            <td>${escapeHtml(e.ref)}</td>
            <td>${escapeHtml(e.itemName ? e.itemName + (e.note ? ' — ' + e.note : '') : e.note) || '-'}</td>
            <td class="num">${e.qtyIn > 0 ? e.qtyIn.toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.qtyOut > 0 ? e.qtyOut.toLocaleString('en-US') : '-'}</td>
            <td class="num">${e.runningBalance.toLocaleString('en-US')}</td>
        </tr>
    `).join('');
}

// ==================== ACTIVATION ENTRY ====================
function renderActivationList() {
    const tbody = $('activation-table-body');
    if (!tbody) return;

    const term = ($('activation-search')?.value || '').trim().toLowerCase();
    let entries = lfGetAll(LF_KEYS.RSO_ACTIVATIONS);

    if (isRsoUser()) {
        entries = entries.filter(e => e.rsoUserId === getCurrentRsoUserId());
    }

    if (term) {
        entries = entries.filter(e =>
            (e.customerName || '').toLowerCase().includes(term) ||
            (e.date || '').includes(term) ||
            matchesAmount(e.claimedCount, term)
        );
    }

    entries = applyDateFilter(entries, 'activation-from', 'activation-to');
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('activation-count').textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

    if (entries.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No activation entries yet.</td></tr>`;
        return;
    }

    const rsoUsers = !isRsoUser() ? lfGetAll(LF_KEYS.USERS) : [];

    tbody.innerHTML = entries.map(e => {
        const rsoName = isRsoUser() ? '' : (rsoUsers.find(u => u.id === e.rsoUserId)?.fullName || '-');
        return `
        <tr>
            <td>${escapeHtml(e.date)}</td>
            <td>${escapeHtml(e.customerName || '-')}</td>
            <td class="num">${e.claimedCount}</td>
            ${!isRsoUser() ? `<td>${escapeHtml(rsoName)}</td>` : ''}
            <td>${escapeHtml(e.note) || '-'}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openActivationForm('${e.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteActivation('${e.id}')">Delete</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function openActivationForm(editId = null) {
    const form = $('activation-form');
    form.reset();
    $('activation-id').value = '';

    if (!isRsoUser()) {
        populateRsoUserDropdown('activation-rso-user');
        $('activation-rso-field').classList.remove('hidden');
    } else {
        $('activation-rso-field').classList.add('hidden');
    }

    if (editId) {
        const e = lfFindById(LF_KEYS.RSO_ACTIVATIONS, editId);
        if (!e) { showToast('Entry not found.', 'error'); return; }
        $('activation-modal-title').textContent = 'Edit Activation Entry';
        $('activation-id').value = e.id;
        $('activation-date').value = e.date;
        if (!isRsoUser()) $('activation-rso-user').value = e.rsoUserId;
        populateActivationCustomerDropdown(e.rsoUserId);
        $('activation-customer').value = e.customerId;
        $('activation-claimed').value = e.claimedCount;
        $('activation-note').value = e.note || '';
    } else {
        $('activation-modal-title').textContent = 'New Activation Entry';
        $('activation-date').value = new Date().toISOString().slice(0, 10);
        if (isRsoUser()) populateActivationCustomerDropdown(getCurrentRsoUserId());
    }

    $('activation-modal').classList.remove('hidden');
    setTimeout(() => $('activation-claimed')?.focus(), 80);
}

function closeActivationForm() { $('activation-modal').classList.add('hidden'); }

function onActivationRsoChange() {
    populateActivationCustomerDropdown($('activation-rso-user').value);
}

function populateActivationCustomerDropdown(rsoUserId) {
    const select = $('activation-customer');
    if (!select) return;
    const customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c =>
        c.rsoUserId === rsoUserId && (c.customerType === 'BTL' || c.customerType === 'Retailer')
    );
    select.innerHTML = '<option value="">Select customer…</option>' +
        customers.map(c => {
            const tag = c.customerType === 'BTL' ? ' [BTL]' : '';
            return `<option value="${c.id}">${escapeHtml(c.shopName || c.name)}${tag}</option>`;
        }).join('');
}

async function saveActivation() {
    const id = $('activation-id').value;
    const date = $('activation-date').value;
    const customerId = $('activation-customer').value;
    const claimedCount = parseInt($('activation-claimed').value) || 0;
    const note = sanitizeInput($('activation-note').value);
    const saveBtn = $('activation-save-btn');
    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : $('activation-rso-user').value;

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!rsoUserId) { showToast('Please select an RSO.', 'warning'); return; }
    if (!customerId) { showToast('Please select a customer.', 'warning'); return; }
    if (claimedCount <= 0) { showToast('Enter claimed SIM count.', 'warning'); return; }

    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);

    setBtnLoading(saveBtn, true);
    try {
        await lfUpsert(LF_KEYS.RSO_ACTIVATIONS, {
            id: id || undefined, date, rsoUserId, customerId,
            customerName: customer ? (customer.shopName || customer.name) : '',
            claimedCount, note,
            enteredBy: getCurrentUserDisplayName()
        });
        showToast(id ? 'Entry updated.' : 'Activation entry saved.', 'success');
        closeActivationForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteActivation(id) {
    const e = lfFindById(LF_KEYS.RSO_ACTIVATIONS, id);
    if (!e) return;
    if (!confirm('Delete this activation entry?')) return;
    try {
        await lfDelete(LF_KEYS.RSO_ACTIVATIONS, id);
        showToast('Entry deleted.', 'success');
    } catch (err) {
        console.error(err);
        showToast('Could not delete.', 'error');
    }
}

// ==================== MONTHLY VERIFICATION ====================
function renderVerificationList() {
    const tbody = $('verification-table-body');
    if (!tbody) return;

    let results = lfGetAll(LF_KEYS.ACTIVATION_RESULTS);
    results.sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    $('verification-count').textContent = `${results.length} record${results.length === 1 ? '' : 's'}`;

    if (results.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No verification records yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = results.map(r => {
        const statusClass = r.status === 'Paid' ? 'is-cr' : (r.status === 'Verified' ? 'is-dr' : '');
        return `
        <tr>
            <td>${escapeHtml(r.period)}</td>
            <td>${escapeHtml(r.customerName || '-')}</td>
            <td class="num">${r.totalClaimed || 0}</td>
            <td class="num">${r.realCount || 0}</td>
            <td class="num">${r.nonRealCount || 0}</td>
            <td class="num">${formatCurrency(r.commissionAmount || 0)}</td>
            <td><span class="balance-tag ${statusClass}">${escapeHtml(r.status || 'Pending')}</span></td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openVerificationForm('${r.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteVerification('${r.id}')">Delete</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function openVerificationForm(editId = null) {
    const form = $('verification-form');
    form.reset();
    $('verification-id').value = '';

    const customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c => c.isCommission);
    $('verification-customer').innerHTML = '<option value="">Select customer…</option>' +
        customers.map(c => `<option value="${c.id}">${escapeHtml(c.shopName || c.name)}</option>`).join('');

    if (editId) {
        const r = lfFindById(LF_KEYS.ACTIVATION_RESULTS, editId);
        if (!r) { showToast('Record not found.', 'error'); return; }
        $('verification-modal-title').textContent = 'Edit Verification';
        $('verification-id').value = r.id;
        $('verification-period').value = r.period;
        $('verification-customer').value = r.customerId;
        $('verification-claimed').value = r.totalClaimed || 0;
        $('verification-real').value = r.realCount || 0;
        $('verification-nonreal').value = r.nonRealCount || 0;
        $('verification-status').value = r.status || 'Pending';
        recalcVerificationCommission();
    } else {
        $('verification-modal-title').textContent = 'New Verification';
        const now = new Date();
        $('verification-period').value = now.toISOString().slice(0, 7);
    }

    $('verification-modal').classList.remove('hidden');
}

function closeVerificationForm() { $('verification-modal').classList.add('hidden'); }

function recalcVerificationCommission() {
    const customerId = $('verification-customer').value;
    const realCount = parseInt($('verification-real').value) || 0;
    const customer = customerId ? lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId) : null;
    const rate = customer ? (customer.commissionRate || 0) : 0;
    const commission = realCount * rate;
    $('verification-commission').textContent = formatCurrency(commission);
    $('verification-rate-display').textContent = `@ Rs.${rate}/SIM`;
}

async function saveVerification() {
    const id = $('verification-id').value;
    const period = $('verification-period').value;
    const customerId = $('verification-customer').value;
    const totalClaimed = parseInt($('verification-claimed').value) || 0;
    const realCount = parseInt($('verification-real').value) || 0;
    const nonRealCount = parseInt($('verification-nonreal').value) || 0;
    const status = $('verification-status').value || 'Pending';
    const saveBtn = $('verification-save-btn');

    if (!period) { showToast('Please select a period.', 'warning'); return; }
    if (!customerId) { showToast('Please select a customer.', 'warning'); return; }

    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);
    const commissionRate = customer ? (customer.commissionRate || 0) : 0;
    const commissionAmount = realCount * commissionRate;

    setBtnLoading(saveBtn, true);
    try {
        await lfUpsert(LF_KEYS.ACTIVATION_RESULTS, {
            id: id || undefined, period, customerId,
            customerName: customer ? (customer.shopName || customer.name) : '',
            rsoUserId: customer ? customer.rsoUserId : '',
            totalClaimed, realCount, nonRealCount,
            commissionRate, commissionAmount, status
        });
        showToast(id ? 'Verification updated.' : 'Verification saved.', 'success');
        closeVerificationForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteVerification(id) {
    if (!confirm('Delete this verification record?')) return;
    try {
        await lfDelete(LF_KEYS.ACTIVATION_RESULTS, id);
        showToast('Record deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== BVS DEVICE REGISTER ====================
function renderBvsDeviceList() {
    const tbody = $('bvs-table-body');
    if (!tbody) return;

    const term = ($('bvs-search')?.value || '').trim().toLowerCase();
    let devices = lfGetAll(LF_KEYS.BVS_DEVICES);

    if (term) {
        devices = devices.filter(d =>
            (d.imei || '').toLowerCase().includes(term) ||
            (d.currentCustomerName || '').toLowerCase().includes(term) ||
            (d.status || '').toLowerCase().includes(term)
        );
    }

    devices.sort((a, b) => (a.imei || '').localeCompare(b.imei || ''));
    $('bvs-count').textContent = `${devices.length} device${devices.length === 1 ? '' : 's'}`;

    if (devices.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No BVS devices registered yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = devices.map(d => {
        const statusClass = d.status === 'Assigned' ? 'is-dr' : (d.status === 'Available' ? 'is-cr' : '');
        return `
        <tr>
            <td><strong>${escapeHtml(d.imei)}</strong></td>
            <td>${escapeHtml(d.currentCustomerName || '—')}</td>
            <td><span class="balance-tag ${statusClass}">${escapeHtml(d.status || 'Available')}</span></td>
            <td>${d.assignedDate || '—'}</td>
            <td>
                <div class="row-actions">
                    ${d.status === 'Available' ? `<button class="btn-outline-text" onclick="openBvsAssignForm('${d.id}')">Assign</button>` : ''}
                    ${d.status === 'Assigned' ? `<button class="btn-outline-text" onclick="unassignBvsDevice('${d.id}')">Unassign</button>` : ''}
                    <button class="btn-outline-text" onclick="viewBvsHistory('${d.id}')">History</button>
                    <button class="btn-danger-text" onclick="deleteBvsDevice('${d.id}')">Delete</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function openBvsDeviceForm() {
    $('bvs-device-form').reset();
    $('bvs-device-modal-title').textContent = 'Add BVS Device';
    $('bvs-device-modal').classList.remove('hidden');
    setTimeout(() => $('bvs-imei')?.focus(), 80);
}

function closeBvsDeviceForm() { $('bvs-device-modal').classList.add('hidden'); }

async function saveBvsDevice() {
    const imei = sanitizeInput($('bvs-imei').value).trim();
    const saveBtn = $('bvs-device-save-btn');

    if (!imei) { showToast('Enter the IMEI number.', 'warning'); return; }
    if (imei.length < 10) { showToast('IMEI seems too short.', 'warning'); return; }

    const existing = lfGetAll(LF_KEYS.BVS_DEVICES).find(d => d.imei === imei);
    if (existing) { showToast('A device with this IMEI already exists.', 'error'); return; }

    setBtnLoading(saveBtn, true);
    try {
        await lfUpsert(LF_KEYS.BVS_DEVICES, {
            imei, status: 'Available',
            currentCustomerId: '', currentCustomerName: '',
            assignedDate: '', history: []
        });
        showToast('Device added.', 'success');
        closeBvsDeviceForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

function openBvsAssignForm(deviceId) {
    const d = lfFindById(LF_KEYS.BVS_DEVICES, deviceId);
    if (!d) return;

    $('bvs-assign-device-id').value = deviceId;
    $('bvs-assign-imei').textContent = d.imei;

    const retailers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c => c.customerType === 'Retailer');
    $('bvs-assign-customer').innerHTML = '<option value="">Select retailer…</option>' +
        retailers.map(c => `<option value="${c.id}">${escapeHtml(c.shopName || c.name)}</option>`).join('');

    $('bvs-assign-modal').classList.remove('hidden');
}

function closeBvsAssignForm() { $('bvs-assign-modal').classList.add('hidden'); }

async function saveBvsAssignment() {
    const deviceId = $('bvs-assign-device-id').value;
    const customerId = $('bvs-assign-customer').value;
    const saveBtn = $('bvs-assign-save-btn');

    if (!customerId) { showToast('Select a retailer.', 'warning'); return; }

    const d = lfFindById(LF_KEYS.BVS_DEVICES, deviceId);
    if (!d) { showToast('Device not found.', 'error'); return; }

    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);
    const today = new Date().toISOString().slice(0, 10);
    const history = d.history || [];
    history.push({ customerId, customerName: customer ? (customer.shopName || customer.name) : '', fromDate: today, toDate: '' });

    setBtnLoading(saveBtn, true);
    try {
        await lfUpsert(LF_KEYS.BVS_DEVICES, {
            ...d, status: 'Assigned',
            currentCustomerId: customerId,
            currentCustomerName: customer ? (customer.shopName || customer.name) : '',
            assignedDate: today, history
        });
        showToast('Device assigned.', 'success');
        closeBvsAssignForm();
    } catch (e) {
        console.error(e);
        showToast('Could not assign.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function unassignBvsDevice(deviceId) {
    const d = lfFindById(LF_KEYS.BVS_DEVICES, deviceId);
    if (!d) return;
    if (!confirm(`Unassign device ${d.imei} from ${d.currentCustomerName}?`)) return;

    const today = new Date().toISOString().slice(0, 10);
    const history = d.history || [];
    if (history.length > 0) {
        history[history.length - 1].toDate = today;
    }

    try {
        await lfUpsert(LF_KEYS.BVS_DEVICES, {
            ...d, status: 'Available',
            currentCustomerId: '', currentCustomerName: '',
            assignedDate: '', history
        });
        showToast('Device unassigned.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not unassign.', 'error');
    }
}

function viewBvsHistory(deviceId) {
    const d = lfFindById(LF_KEYS.BVS_DEVICES, deviceId);
    if (!d) return;

    const history = d.history || [];
    const container = $('bvs-history-body');
    $('bvs-history-imei').textContent = d.imei;

    if (history.length === 0) {
        container.innerHTML = '<p class="hint">No assignment history for this device.</p>';
    } else {
        container.innerHTML = `<table class="data-table"><thead><tr><th>Retailer</th><th>From</th><th>To</th></tr></thead><tbody>` +
            history.map(h => `<tr><td>${escapeHtml(h.customerName)}</td><td>${h.fromDate}</td><td>${h.toDate || '<em>Current</em>'}</td></tr>`).join('') +
            '</tbody></table>';
    }

    $('bvs-history-modal').classList.remove('hidden');
}

function closeBvsHistoryModal() { $('bvs-history-modal').classList.add('hidden'); }

async function deleteBvsDevice(id) {
    const d = lfFindById(LF_KEYS.BVS_DEVICES, id);
    if (!d) return;
    if (d.status === 'Assigned') {
        showToast('Unassign the device before deleting.', 'warning');
        return;
    }
    if (!confirm(`Delete device ${d.imei}?`)) return;
    try {
        await lfDelete(LF_KEYS.BVS_DEVICES, id);
        showToast('Device deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== COMMISSION REPORT ====================
function renderCommissionReport() {
    const container = $('commission-report-body');
    if (!container) return;

    const period = $('commission-report-period')?.value || '';
    if (!period) {
        container.innerHTML = '<p class="hint">Select a month to view commission report.</p>';
        return;
    }

    const results = lfGetAll(LF_KEYS.ACTIVATION_RESULTS).filter(r => r.period === period);

    if (results.length === 0) {
        container.innerHTML = '<p class="hint">No verification data for this period.</p>';
        return;
    }

    let totalCommission = 0;
    let html = `<table class="data-table"><thead><tr><th>Customer</th><th class="num">Claimed</th><th class="num">Real</th><th class="num">Non-Real</th><th class="num">Rate</th><th class="num">Commission</th><th>Status</th></tr></thead><tbody>`;

    results.forEach(r => {
        totalCommission += (r.commissionAmount || 0);
        const statusClass = r.status === 'Paid' ? 'is-cr' : '';
        html += `<tr>
            <td>${escapeHtml(r.customerName)}</td>
            <td class="num">${r.totalClaimed || 0}</td>
            <td class="num">${r.realCount || 0}</td>
            <td class="num">${r.nonRealCount || 0}</td>
            <td class="num">${formatCurrency(r.commissionRate || 0)}</td>
            <td class="num">${formatCurrency(r.commissionAmount || 0)}</td>
            <td><span class="balance-tag ${statusClass}">${r.status || 'Pending'}</span></td>
        </tr>`;
    });

    html += `<tr class="statement-total"><td colspan="5"><strong>Total Commission</strong></td><td class="num"><strong>${formatCurrency(totalCommission)}</strong></td><td></td></tr>`;
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ==================== SIM STATUS REPORT ====================
function renderSimStatusReport() {
    const container = $('sim-status-report-body');
    if (!container) return;

    const activations = lfGetAll(LF_KEYS.RSO_ACTIVATIONS);
    const results = lfGetAll(LF_KEYS.ACTIVATION_RESULTS);

    const totalClaimed = activations.reduce((s, a) => s + (a.claimedCount || 0), 0);
    const totalVerifiedReal = results.reduce((s, r) => s + (r.realCount || 0), 0);
    const totalVerifiedNonReal = results.reduce((s, r) => s + (r.nonRealCount || 0), 0);
    const totalVerified = totalVerifiedReal + totalVerifiedNonReal;
    const pending = totalClaimed - totalVerified;

    let html = `<div class="statement-section">
        <table class="data-table"><tbody>
            <tr><td>Total SIMs Claimed (Activations)</td><td class="num"><strong>${totalClaimed}</strong></td></tr>
            <tr><td>Verified Real</td><td class="num" style="color:var(--green)">${totalVerifiedReal}</td></tr>
            <tr><td>Verified Non-Real</td><td class="num" style="color:var(--red)">${totalVerifiedNonReal}</td></tr>
            <tr><td>Pending Verification</td><td class="num">${Math.max(pending, 0)}</td></tr>
            <tr class="statement-total"><td><strong>Real Rate</strong></td><td class="num"><strong>${totalVerified > 0 ? ((totalVerifiedReal / totalVerified) * 100).toFixed(1) + '%' : '—'}</strong></td></tr>
        </tbody></table>
    </div>`;

    const byCustomer = {};
    activations.forEach(a => {
        if (!byCustomer[a.customerId]) byCustomer[a.customerId] = { name: a.customerName, claimed: 0, real: 0, nonReal: 0 };
        byCustomer[a.customerId].claimed += (a.claimedCount || 0);
    });
    results.forEach(r => {
        if (!byCustomer[r.customerId]) byCustomer[r.customerId] = { name: r.customerName, claimed: 0, real: 0, nonReal: 0 };
        byCustomer[r.customerId].real += (r.realCount || 0);
        byCustomer[r.customerId].nonReal += (r.nonRealCount || 0);
    });

    const rows = Object.values(byCustomer).sort((a, b) => b.claimed - a.claimed);
    if (rows.length > 0) {
        html += `<h3 style="margin:1.2rem 0 0.6rem">By Customer</h3>
        <table class="data-table"><thead><tr><th>Customer</th><th class="num">Claimed</th><th class="num">Real</th><th class="num">Non-Real</th><th class="num">Real %</th></tr></thead><tbody>`;
        rows.forEach(r => {
            const total = r.real + r.nonReal;
            const pct = total > 0 ? ((r.real / total) * 100).toFixed(1) + '%' : '—';
            html += `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.claimed}</td><td class="num">${r.real}</td><td class="num">${r.nonReal}</td><td class="num">${pct}</td></tr>`;
        });
        html += '</tbody></table>';
    }

    container.innerHTML = html;
}
