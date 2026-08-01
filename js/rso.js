/**
 * LedgerFlow - RSO (Route Sales Officer / Salesman) Module
 *
 * Complete FMCG distribution workflow:
 *   Admin issues stock (load) to RSO → RSO sells to their customers →
 *   RSO collects payments → RSO deposits cash to company.
 *
 * Each RSO sees only their own customers, sales, stock, and reports.
 * Admin sees everything across all RSOs.
 *
 * Double-entry accounting:
 *   Issue to RSO:    Dr RSO A/c (Employee/RSO)  |  Cr Purchase/Stock
 *   RSO Sale:        Dr RSO Customer            |  Cr RSO A/c
 *   RSO Recovery:    Dr RSO Cash-in-hand         |  Cr RSO Customer
 *   RSO Deposit:     Dr Company Cash/Bank        |  Cr RSO A/c
 *   RSO Return:      Dr RSO A/c                  |  Cr RSO Customer
 */

// ==================== HELPERS ====================
function getCurrentRsoUserId() {
    const user = getCurrentUserRecord();
    return user ? user.id : null;
}

function isRsoUser() {
    const user = getCurrentUserRecord();
    return user && user.role === 'rso';
}

function getRsoAccountForUser(userId) {
    return lfGetAll(LF_KEYS.ACCOUNTS).find(a => a.type === 'Employee/RSO' && a.linkedUserId === userId) || null;
}

function getAllRsoUsers() {
    return lfGetAll(LF_KEYS.USERS).filter(u => u.role === 'rso');
}

// ==================== RSO CUSTOMER MANAGEMENT ====================
function renderRsoCustomerList(searchTerm = '') {
    const tbody = $('rso-customer-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS);

    if (isRsoUser()) {
        customers = customers.filter(c => c.rsoUserId === getCurrentRsoUserId());
    }

    if (term) {
        customers = customers.filter(c =>
            (c.name || '').toLowerCase().includes(term) ||
            (c.shopName || '').toLowerCase().includes(term) ||
            (c.mobile || '').toLowerCase().includes(term) ||
            (c.area || '').toLowerCase().includes(term)
        );
    }

    customers.sort((a, b) => (a.shopName || a.name).localeCompare(b.shopName || b.name));
    $('rso-customer-count').textContent = `${customers.length} customer${customers.length === 1 ? '' : 's'}`;

    if (customers.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No RSO customers yet — click "New Customer" to add one.</td></tr>`;
        return;
    }

    tbody.innerHTML = customers.map(c => {
        const bal = computeRsoCustomerBalance(c.id);
        const rsoUser = !isRsoUser() ? lfGetAll(LF_KEYS.USERS).find(u => u.id === c.rsoUserId) : null;
        return `
        <tr>
            <td><strong>${escapeHtml(c.shopName || c.name)}</strong>${c.shopName ? `<br><small>${escapeHtml(c.name)}</small>` : ''}</td>
            <td>${c.mobile ? '+92 ' + escapeHtml(c.mobile) : '-'}</td>
            <td>${escapeHtml(c.area) || '-'}</td>
            <td class="num">${formatCurrency(c.creditLimit || 0)}</td>
            <td class="num"><span class="balance-tag ${bal.amount === 0 ? 'is-cr' : 'is-dr'}">${formatCurrency(bal.amount)}</span></td>
            ${!isRsoUser() ? `<td>${rsoUser ? escapeHtml(rsoUser.fullName) : '-'}</td>` : ''}
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openRsoCustomerForm('${c.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteRsoCustomer('${c.id}')">Delete</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function computeRsoCustomerBalance(customerId) {
    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);
    let net = customer ? (customer.openingBalance || 0) : 0;

    lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.customerId === customerId).forEach(s => {
        net += s.grandTotal;
    });

    lfGetAll(LF_KEYS.RSO_RETURNS).filter(r => r.customerId === customerId).forEach(r => {
        net -= r.grandTotal;
    });

    lfGetAll(LF_KEYS.RSO_RECOVERIES).filter(r => r.customerId === customerId).forEach(r => {
        net -= r.amount;
    });

    return { amount: Math.abs(net), side: net >= 0 ? 'Dr' : 'Cr' };
}

function openRsoCustomerForm(id = null) {
    const modal = $('rso-customer-modal');
    const form = $('rso-customer-form');
    form.reset();
    $('rso-cust-id').value = '';

    if (id) {
        const c = lfFindById(LF_KEYS.RSO_CUSTOMERS, id);
        if (!c) { showToast('Customer not found.', 'error'); return; }
        $('rso-customer-modal-title').textContent = 'Edit Customer';
        $('rso-cust-id').value = c.id;
        $('rso-cust-name').value = c.name;
        $('rso-cust-shop').value = c.shopName || '';
        $('rso-cust-mobile').value = c.mobile || '';
        $('rso-cust-address').value = c.address || '';
        $('rso-cust-area').value = c.area || '';
        $('rso-cust-credit-limit').value = c.creditLimit ? c.creditLimit.toLocaleString('en-US') : '';
        $('rso-cust-opening').value = c.openingBalance ? c.openingBalance.toLocaleString('en-US') : '';
        if (!isRsoUser()) {
            $('rso-cust-rso-user').value = c.rsoUserId || '';
        }
    } else {
        $('rso-customer-modal-title').textContent = 'New Customer';
    }

    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-cust-rso-user');
        $('rso-cust-rso-field').classList.remove('hidden');
    } else {
        $('rso-cust-rso-field').classList.add('hidden');
    }

    modal.classList.remove('hidden');
    setTimeout(() => $('rso-cust-name')?.focus(), 80);
}

function closeRsoCustomerForm() {
    $('rso-customer-modal').classList.add('hidden');
}

function populateRsoUserDropdown(selectId) {
    const select = $(selectId);
    if (!select) return;
    const rsoUsers = getAllRsoUsers();
    select.innerHTML = '<option value="">Select RSO…</option>' +
        rsoUsers.map(u => `<option value="${u.id}">${escapeHtml(u.fullName)}</option>`).join('');
}

async function saveRsoCustomer() {
    const id = $('rso-cust-id').value;
    const name = sanitizeInput($('rso-cust-name').value);
    const shopName = sanitizeInput($('rso-cust-shop').value);
    const mobile = getDigitsOnly($('rso-cust-mobile').value);
    const address = sanitizeInput($('rso-cust-address').value);
    const area = sanitizeInput($('rso-cust-area').value);
    const creditLimit = parseAmount($('rso-cust-credit-limit').value);
    const openingBalance = parseAmount($('rso-cust-opening').value);
    const saveBtn = $('rso-customer-save-btn');

    if (!name) { showToast('Please enter customer name.', 'warning'); $('rso-cust-name').focus(); return; }

    let rsoUserId;
    if (isRsoUser()) {
        rsoUserId = getCurrentRsoUserId();
    } else {
        rsoUserId = $('rso-cust-rso-user').value;
        if (!rsoUserId) { showToast('Please select which RSO this customer belongs to.', 'warning'); return; }
    }

    setBtnLoading(saveBtn, true);

    try {
        const record = {
            id: id || undefined,
            rsoUserId, name, shopName, mobile, address, area,
            creditLimit, openingBalance
        };
        await lfUpsert(LF_KEYS.RSO_CUSTOMERS, record);
        showToast(id ? 'Customer updated.' : 'Customer created.', 'success');
        closeRsoCustomerForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save customer.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteRsoCustomer(id) {
    const c = lfFindById(LF_KEYS.RSO_CUSTOMERS, id);
    if (!c) return;

    const salesCount = lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.customerId === id).length;
    if (salesCount > 0) {
        showToast(`Can't delete — this customer has ${salesCount} sale${salesCount === 1 ? '' : 's'}. Stop using them instead.`, 'error', 5000);
        return;
    }
    if (!confirm(`Delete "${c.shopName || c.name}"? This cannot be undone.`)) return;

    try {
        await lfDelete(LF_KEYS.RSO_CUSTOMERS, id);
        showToast('Customer deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== RSO LOAD (Admin issues stock to RSO) ====================
function renderRsoLoadList(searchTerm = '') {
    const tbody = $('rso-load-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let loads = lfGetAll(LF_KEYS.RSO_LOADS);

    if (isRsoUser()) {
        loads = loads.filter(l => l.rsoUserId === getCurrentRsoUserId());
    }

    if (term) {
        loads = loads.filter(l =>
            (l.number || '').toLowerCase().includes(term) ||
            (l.rsoName || '').toLowerCase().includes(term)
        );
    }

    loads.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('rso-load-count').textContent = `${loads.length} load${loads.length === 1 ? '' : 's'}`;

    if (loads.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No loads issued yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = loads.map(l => `
        <tr>
            <td><strong>${escapeHtml(l.number)}</strong></td>
            <td>${escapeHtml(l.date)}</td>
            <td>${escapeHtml(l.rsoName)}</td>
            <td>${l.items.length} item${l.items.length === 1 ? '' : 's'}</td>
            <td class="num">${formatCurrency(l.grandTotal)}</td>
            <td>
                <div class="row-actions">
                    ${!isRsoUser() ? `<button class="btn-outline-text" onclick="openRsoLoadForm('${l.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteRsoLoad('${l.id}')">Delete</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

let rsoLoadItemCounter = 0;

function openRsoLoadForm(editId = null) {
    if (isRsoUser()) { showToast('Only Admin can issue stock loads.', 'warning'); return; }

    const form = $('rso-load-form');
    form.reset();
    $('rso-load-id').value = '';
    $('rso-load-item-rows').innerHTML = '';
    rsoLoadItemCounter = 0;

    populateRsoUserDropdown('rso-load-rso-user');

    if (editId) {
        const l = lfFindById(LF_KEYS.RSO_LOADS, editId);
        if (!l) { showToast('Load not found.', 'error'); return; }
        $('rso-load-modal-title').textContent = 'Edit RSO Load';
        $('rso-load-id').value = l.id;
        $('rso-load-number').value = l.number;
        $('rso-load-date').value = l.date;
        $('rso-load-rso-user').value = l.rsoUserId;
        renderRsoLoadItemRows();
        applyRsoLoadItemValues(l.items);
    } else {
        $('rso-load-modal-title').textContent = 'Issue Stock to RSO';
        $('rso-load-number').value = peekNextDocNumber('RsoLoad', 'RL');
        $('rso-load-date').value = new Date().toISOString().slice(0, 10);
        renderRsoLoadItemRows();
    }

    recalcRsoLoadTotal();
    $('rso-load-modal').classList.remove('hidden');
}

function closeRsoLoadForm() { $('rso-load-modal').classList.add('hidden'); }

function renderRsoLoadItemRows() {
    const container = $('rso-load-item-rows');
    const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));

    if (items.length === 0) {
        container.innerHTML = `<div class="item-rows-empty">No items in catalog.</div>`;
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="item-row" data-item-id="${item.id}">
            <span class="rights-item-name">${escapeHtml(item.name)}</span>
            <input type="text" inputmode="decimal" placeholder="0" oninput="recalcRsoLoadTotal()">
            <input type="text" inputmode="decimal" placeholder="${item.purchasePrice || 0}" value="${item.purchasePrice || ''}" oninput="recalcRsoLoadTotal()">
            <span class="row-amount">Rs. 0</span>
        </div>
    `).join('');
}

function applyRsoLoadItemValues(savedItems) {
    (savedItems || []).forEach(saved => {
        const row = document.querySelector(`#rso-load-item-rows .item-row[data-item-id="${saved.itemId}"]`);
        if (!row) return;
        const inputs = row.querySelectorAll('input');
        inputs[0].value = saved.qty;
        inputs[1].value = saved.rate;
        updateRowAmount(row);
    });
}

function getRsoLoadItemRows() {
    return [...document.querySelectorAll('#rso-load-item-rows .item-row')].map(row => {
        const itemId = row.dataset.itemId;
        const item = lfFindById(LF_KEYS.ITEMS, itemId);
        const inputs = row.querySelectorAll('input');
        const qty = parseAmount(inputs[0].value);
        const rate = parseAmount(inputs[1].value);
        return { itemId, itemName: item ? item.name : '', qty, rate, amount: qty * rate };
    }).filter(r => r.qty > 0);
}

function recalcRsoLoadTotal() {
    const items = getRsoLoadItemRows();
    const total = items.reduce((sum, r) => sum + r.amount, 0);
    $('rso-load-grand-total').textContent = formatCurrency(total);
    return total;
}

async function saveRsoLoad() {
    const id = $('rso-load-id').value;
    const date = $('rso-load-date').value;
    const rsoUserId = $('rso-load-rso-user').value;
    const items = getRsoLoadItemRows();
    const saveBtn = $('rso-load-save-btn');

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!rsoUserId) { showToast('Please select an RSO.', 'warning'); return; }
    if (items.length === 0) { showToast('Add at least one item with quantity.', 'warning'); return; }

    const grandTotal = items.reduce((sum, r) => sum + r.amount, 0);
    const rsoUser = lfFindById(LF_KEYS.USERS, rsoUserId);
    const rsoAccount = getRsoAccountForUser(rsoUserId);

    setBtnLoading(saveBtn, true);

    try {
        if (id) {
            await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);
            await lfDeleteWhereInvoiceId(LF_KEYS.ITEM_LEDGER, id);
        }

        const loadId = id || generateId();
        const number = id ? $('rso-load-number').value : await takeNextDocNumber('RsoLoad', 'RL');

        const writes = [];

        if (rsoAccount && grandTotal > 0) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: loadId, accountId: rsoAccount.id, date, type: 'RsoLoad',
                ref: number, side: 'Dr', amount: grandTotal,
                note: `Stock issued to ${rsoUser ? rsoUser.fullName : 'RSO'} ${number}`
            }));
        }

        items.forEach(row => {
            writes.push(lfUpsert(LF_KEYS.ITEM_LEDGER, {
                invoiceId: loadId, date, type: 'RsoLoad', ref: number,
                itemId: row.itemId, itemName: row.itemName,
                qtyChange: -row.qty,
                note: `Issued to ${rsoUser ? rsoUser.fullName : 'RSO'} ${number}`
            }));
        });

        await Promise.all(writes);

        const record = {
            id: loadId, number, date, rsoUserId,
            rsoName: rsoUser ? rsoUser.fullName : '',
            items, grandTotal,
            enteredBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.RSO_LOADS, record);

        showToast(`Stock load ${id ? 'updated' : 'issued'} as ${number}.`, 'success');
        closeRsoLoadForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save load.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteRsoLoad(id) {
    const l = lfFindById(LF_KEYS.RSO_LOADS, id);
    if (!l) return;
    if (!confirm(`Delete load ${l.number}? This reverses all ledger entries.`)) return;
    try {
        await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);
        await lfDeleteWhereInvoiceId(LF_KEYS.ITEM_LEDGER, id);
        await lfDelete(LF_KEYS.RSO_LOADS, id);
        showToast('Load deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== RSO STOCK COMPUTATION ====================
function computeRsoStock(rsoUserId) {
    const items = lfGetAll(LF_KEYS.ITEMS);
    const stock = {};

    items.forEach(item => { stock[item.id] = { itemName: item.name, qty: 0, rate: item.salePrice || 0 }; });

    lfGetAll(LF_KEYS.RSO_LOADS).filter(l => l.rsoUserId === rsoUserId).forEach(l => {
        (l.items || []).forEach(i => {
            if (!stock[i.itemId]) stock[i.itemId] = { itemName: i.itemName, qty: 0, rate: i.rate };
            stock[i.itemId].qty += i.qty;
        });
    });

    lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.rsoUserId === rsoUserId).forEach(s => {
        (s.items || []).forEach(i => {
            if (stock[i.itemId]) stock[i.itemId].qty -= i.qty;
        });
    });

    lfGetAll(LF_KEYS.RSO_RETURNS).filter(r => r.rsoUserId === rsoUserId).forEach(r => {
        (r.items || []).forEach(i => {
            if (stock[i.itemId]) stock[i.itemId].qty += i.qty;
        });
    });

    return stock;
}

// ==================== RSO SALE ====================
function renderRsoSaleList(searchTerm = '') {
    const tbody = $('rso-sale-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let sales = lfGetAll(LF_KEYS.RSO_SALES);

    if (isRsoUser()) {
        sales = sales.filter(s => s.rsoUserId === getCurrentRsoUserId());
    }

    if (term) {
        sales = sales.filter(s =>
            (s.number || '').toLowerCase().includes(term) ||
            (s.customerName || '').toLowerCase().includes(term)
        );
    }

    sales.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('rso-sale-count').textContent = `${sales.length} sale${sales.length === 1 ? '' : 's'}`;

    if (sales.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No RSO sales yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = sales.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.number)}</strong></td>
            <td>${escapeHtml(s.date)}</td>
            <td>${escapeHtml(s.customerName)}</td>
            <td>${s.items.length} item${s.items.length === 1 ? '' : 's'}</td>
            <td class="num">${formatCurrency(s.grandTotal)}</td>
            <td class="num">${formatCurrency(s.paidAmount || 0)}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openRsoSaleForm('${s.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteRsoSale('${s.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openRsoSaleForm(editId = null) {
    const form = $('rso-sale-form');
    form.reset();
    $('rso-sale-id').value = '';
    $('rso-sale-item-rows').innerHTML = '';

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : null;

    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-sale-rso-user');
        $('rso-sale-rso-field').classList.remove('hidden');
    } else {
        $('rso-sale-rso-field').classList.add('hidden');
    }

    if (editId) {
        const s = lfFindById(LF_KEYS.RSO_SALES, editId);
        if (!s) { showToast('Sale not found.', 'error'); return; }
        $('rso-sale-modal-title').textContent = 'Edit RSO Sale';
        $('rso-sale-id').value = s.id;
        $('rso-sale-number').value = s.number;
        $('rso-sale-date').value = s.date;
        if (!isRsoUser()) $('rso-sale-rso-user').value = s.rsoUserId;
        populateRsoCustomerDropdown(s.rsoUserId);
        $('rso-sale-customer').value = s.customerId;
        renderRsoSaleItemRows(s.rsoUserId);
        applyRsoSaleItemValues(s.items);
        $('rso-sale-paid').value = (s.paidAmount || 0).toLocaleString('en-US');
    } else {
        $('rso-sale-modal-title').textContent = 'New RSO Sale';
        $('rso-sale-number').value = peekNextDocNumber('RsoSale', 'RS');
        $('rso-sale-date').value = new Date().toISOString().slice(0, 10);
        if (rsoUserId) {
            populateRsoCustomerDropdown(rsoUserId);
            renderRsoSaleItemRows(rsoUserId);
        }
    }

    recalcRsoSaleTotal();
    $('rso-sale-modal').classList.remove('hidden');
}

function closeRsoSaleForm() { $('rso-sale-modal').classList.add('hidden'); }

function onRsoSaleRsoChange() {
    const rsoUserId = $('rso-sale-rso-user').value;
    populateRsoCustomerDropdown(rsoUserId);
    renderRsoSaleItemRows(rsoUserId);
    recalcRsoSaleTotal();
}

function populateRsoCustomerDropdown(rsoUserId) {
    const select = $('rso-sale-customer');
    if (!select) return;
    const customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c => c.rsoUserId === rsoUserId);
    select.innerHTML = '<option value="">Select customer…</option>' +
        customers.map(c => `<option value="${c.id}">${escapeHtml(c.shopName || c.name)}</option>`).join('');
}

function renderRsoSaleItemRows(rsoUserId) {
    const container = $('rso-sale-item-rows');
    if (!container) return;
    const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));
    const stock = rsoUserId ? computeRsoStock(rsoUserId) : {};

    if (items.length === 0) {
        container.innerHTML = `<div class="item-rows-empty">No items in catalog.</div>`;
        return;
    }

    container.innerHTML = items.map(item => {
        const avail = stock[item.id] ? stock[item.id].qty : 0;
        return `
        <div class="item-row" data-item-id="${item.id}">
            <span class="rights-item-name">${escapeHtml(item.name)} <small style="color:var(--text-muted)">(${avail})</small></span>
            <input type="text" inputmode="decimal" placeholder="0" oninput="recalcRsoSaleTotal()">
            <input type="text" inputmode="decimal" placeholder="${item.salePrice || 0}" value="${item.salePrice || ''}" oninput="recalcRsoSaleTotal()">
            <span class="row-amount">Rs. 0</span>
        </div>`;
    }).join('');
}

function applyRsoSaleItemValues(savedItems) {
    (savedItems || []).forEach(saved => {
        const row = document.querySelector(`#rso-sale-item-rows .item-row[data-item-id="${saved.itemId}"]`);
        if (!row) return;
        const inputs = row.querySelectorAll('input');
        inputs[0].value = saved.qty;
        inputs[1].value = saved.rate;
        updateRowAmount(row);
    });
}

function getRsoSaleItemRows() {
    return [...document.querySelectorAll('#rso-sale-item-rows .item-row')].map(row => {
        const itemId = row.dataset.itemId;
        const item = lfFindById(LF_KEYS.ITEMS, itemId);
        const inputs = row.querySelectorAll('input');
        const qty = parseAmount(inputs[0].value);
        const rate = parseAmount(inputs[1].value);
        return { itemId, itemName: item ? item.name : '', qty, rate, amount: qty * rate };
    }).filter(r => r.qty > 0);
}

function recalcRsoSaleTotal() {
    const items = getRsoSaleItemRows();
    const total = items.reduce((sum, r) => sum + r.amount, 0);
    $('rso-sale-grand-total').textContent = formatCurrency(total);

    const paid = parseAmount($('rso-sale-paid')?.value || '0');
    $('rso-sale-balance').textContent = formatCurrency(Math.max(total - paid, 0));
    return total;
}

async function saveRsoSale() {
    const id = $('rso-sale-id').value;
    const date = $('rso-sale-date').value;
    const customerId = $('rso-sale-customer').value;
    const items = getRsoSaleItemRows();
    const paidAmount = parseAmount($('rso-sale-paid').value);
    const saveBtn = $('rso-sale-save-btn');

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : $('rso-sale-rso-user').value;

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!rsoUserId) { showToast('Please select an RSO.', 'warning'); return; }
    if (!customerId) { showToast('Please select a customer.', 'warning'); return; }
    if (items.length === 0) { showToast('Add at least one item.', 'warning'); return; }

    const grandTotal = items.reduce((sum, r) => sum + r.amount, 0);
    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);
    const rsoAccount = getRsoAccountForUser(rsoUserId);

    setBtnLoading(saveBtn, true);

    try {
        if (id) {
            await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);
        }

        const saleId = id || generateId();
        const number = id ? $('rso-sale-number').value : await takeNextDocNumber('RsoSale', 'RS');

        const writes = [];

        if (rsoAccount && grandTotal > 0) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: saleId, accountId: rsoAccount.id, date, type: 'RsoSale',
                ref: number, side: 'Cr', amount: grandTotal,
                note: `RSO Sale ${number} to ${customer ? (customer.shopName || customer.name) : ''}`
            }));
        }

        if (paidAmount > 0 && rsoAccount) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: saleId, accountId: rsoAccount.id, date, type: 'RsoSale',
                ref: number, side: 'Dr', amount: paidAmount,
                note: `RSO Sale ${number} — cash received`
            }));
        }

        await Promise.all(writes);

        const record = {
            id: saleId, number, date, rsoUserId,
            customerId, customerName: customer ? (customer.shopName || customer.name) : '',
            items, grandTotal, paidAmount,
            balanceAmount: Math.max(grandTotal - paidAmount, 0),
            enteredBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.RSO_SALES, record);

        if (paidAmount > 0) {
            await lfUpsert(LF_KEYS.RSO_RECOVERIES, {
                rsoUserId, customerId, date,
                customerName: customer ? (customer.shopName || customer.name) : '',
                amount: paidAmount, mode: 'Cash',
                ref: number, note: `Cash with sale ${number}`,
                saleId: saleId
            });
        }

        showToast(`RSO Sale ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        closeRsoSaleForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save sale.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteRsoSale(id) {
    const s = lfFindById(LF_KEYS.RSO_SALES, id);
    if (!s) return;
    if (!confirm(`Delete sale ${s.number}?`)) return;
    try {
        await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);
        const linkedRecoveries = lfGetAll(LF_KEYS.RSO_RECOVERIES).filter(r => r.saleId === id);
        for (const r of linkedRecoveries) await lfDelete(LF_KEYS.RSO_RECOVERIES, r.id);
        await lfDelete(LF_KEYS.RSO_SALES, id);
        showToast('Sale deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== RSO SALE RETURN ====================
function renderRsoReturnList(searchTerm = '') {
    const tbody = $('rso-return-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let returns = lfGetAll(LF_KEYS.RSO_RETURNS);

    if (isRsoUser()) {
        returns = returns.filter(r => r.rsoUserId === getCurrentRsoUserId());
    }

    if (term) {
        returns = returns.filter(r =>
            (r.number || '').toLowerCase().includes(term) ||
            (r.customerName || '').toLowerCase().includes(term)
        );
    }

    returns.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('rso-return-count').textContent = `${returns.length} return${returns.length === 1 ? '' : 's'}`;

    if (returns.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No returns yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = returns.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.number)}</strong></td>
            <td>${escapeHtml(r.date)}</td>
            <td>${escapeHtml(r.customerName)}</td>
            <td>${r.items.length} item${r.items.length === 1 ? '' : 's'}</td>
            <td class="num">${formatCurrency(r.grandTotal)}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openRsoReturnForm('${r.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteRsoReturn('${r.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openRsoReturnForm(editId = null) {
    const form = $('rso-return-form');
    form.reset();
    $('rso-return-id').value = '';
    $('rso-return-item-rows').innerHTML = '';

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : null;

    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-return-rso-user');
        $('rso-return-rso-field').classList.remove('hidden');
    } else {
        $('rso-return-rso-field').classList.add('hidden');
    }

    if (editId) {
        const r = lfFindById(LF_KEYS.RSO_RETURNS, editId);
        if (!r) { showToast('Return not found.', 'error'); return; }
        $('rso-return-modal-title').textContent = 'Edit RSO Return';
        $('rso-return-id').value = r.id;
        $('rso-return-number').value = r.number;
        $('rso-return-date').value = r.date;
        if (!isRsoUser()) $('rso-return-rso-user').value = r.rsoUserId;
        populateRsoReturnCustomerDropdown(r.rsoUserId);
        $('rso-return-customer').value = r.customerId;
        renderRsoReturnItemRows();
        applyRsoReturnItemValues(r.items);
    } else {
        $('rso-return-modal-title').textContent = 'New RSO Return';
        $('rso-return-number').value = peekNextDocNumber('RsoReturn', 'RR');
        $('rso-return-date').value = new Date().toISOString().slice(0, 10);
        if (rsoUserId) {
            populateRsoReturnCustomerDropdown(rsoUserId);
        }
        renderRsoReturnItemRows();
    }

    recalcRsoReturnTotal();
    $('rso-return-modal').classList.remove('hidden');
}

function closeRsoReturnForm() { $('rso-return-modal').classList.add('hidden'); }

function onRsoReturnRsoChange() {
    const rsoUserId = $('rso-return-rso-user').value;
    populateRsoReturnCustomerDropdown(rsoUserId);
}

function populateRsoReturnCustomerDropdown(rsoUserId) {
    const select = $('rso-return-customer');
    if (!select) return;
    const customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c => c.rsoUserId === rsoUserId);
    select.innerHTML = '<option value="">Select customer…</option>' +
        customers.map(c => `<option value="${c.id}">${escapeHtml(c.shopName || c.name)}</option>`).join('');
}

function renderRsoReturnItemRows() {
    const container = $('rso-return-item-rows');
    if (!container) return;
    const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = items.map(item => `
        <div class="item-row" data-item-id="${item.id}">
            <span class="rights-item-name">${escapeHtml(item.name)}</span>
            <input type="text" inputmode="decimal" placeholder="0" oninput="recalcRsoReturnTotal()">
            <input type="text" inputmode="decimal" placeholder="${item.salePrice || 0}" value="${item.salePrice || ''}" oninput="recalcRsoReturnTotal()">
            <span class="row-amount">Rs. 0</span>
        </div>
    `).join('');
}

function applyRsoReturnItemValues(savedItems) {
    (savedItems || []).forEach(saved => {
        const row = document.querySelector(`#rso-return-item-rows .item-row[data-item-id="${saved.itemId}"]`);
        if (!row) return;
        const inputs = row.querySelectorAll('input');
        inputs[0].value = saved.qty;
        inputs[1].value = saved.rate;
        updateRowAmount(row);
    });
}

function getRsoReturnItemRows() {
    return [...document.querySelectorAll('#rso-return-item-rows .item-row')].map(row => {
        const itemId = row.dataset.itemId;
        const item = lfFindById(LF_KEYS.ITEMS, itemId);
        const inputs = row.querySelectorAll('input');
        const qty = parseAmount(inputs[0].value);
        const rate = parseAmount(inputs[1].value);
        return { itemId, itemName: item ? item.name : '', qty, rate, amount: qty * rate };
    }).filter(r => r.qty > 0);
}

function recalcRsoReturnTotal() {
    const items = getRsoReturnItemRows();
    const total = items.reduce((sum, r) => sum + r.amount, 0);
    $('rso-return-grand-total').textContent = formatCurrency(total);
    return total;
}

async function saveRsoReturn() {
    const id = $('rso-return-id').value;
    const date = $('rso-return-date').value;
    const customerId = $('rso-return-customer').value;
    const items = getRsoReturnItemRows();
    const saveBtn = $('rso-return-save-btn');

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : $('rso-return-rso-user').value;

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!rsoUserId) { showToast('Please select an RSO.', 'warning'); return; }
    if (!customerId) { showToast('Please select a customer.', 'warning'); return; }
    if (items.length === 0) { showToast('Add at least one item.', 'warning'); return; }

    const grandTotal = items.reduce((sum, r) => sum + r.amount, 0);
    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);
    const rsoAccount = getRsoAccountForUser(rsoUserId);

    setBtnLoading(saveBtn, true);

    try {
        if (id) await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);

        const returnId = id || generateId();
        const number = id ? $('rso-return-number').value : await takeNextDocNumber('RsoReturn', 'RR');

        if (rsoAccount && grandTotal > 0) {
            await lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: returnId, accountId: rsoAccount.id, date, type: 'RsoReturn',
                ref: number, side: 'Dr', amount: grandTotal,
                note: `RSO Return ${number} from ${customer ? (customer.shopName || customer.name) : ''}`
            });
        }

        const record = {
            id: returnId, number, date, rsoUserId,
            customerId, customerName: customer ? (customer.shopName || customer.name) : '',
            items, grandTotal,
            enteredBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.RSO_RETURNS, record);

        showToast(`RSO Return ${id ? 'updated' : 'saved'} as ${number}.`, 'success');
        closeRsoReturnForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save return.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteRsoReturn(id) {
    const r = lfFindById(LF_KEYS.RSO_RETURNS, id);
    if (!r) return;
    if (!confirm(`Delete return ${r.number}?`)) return;
    try {
        await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);
        await lfDelete(LF_KEYS.RSO_RETURNS, id);
        showToast('Return deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== RSO RECOVERY (customer payments) ====================
function renderRsoRecoveryList(searchTerm = '') {
    const tbody = $('rso-recovery-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let recoveries = lfGetAll(LF_KEYS.RSO_RECOVERIES);

    if (isRsoUser()) {
        recoveries = recoveries.filter(r => r.rsoUserId === getCurrentRsoUserId());
    }

    recoveries = recoveries.filter(r => !r.saleId);

    if (term) {
        recoveries = recoveries.filter(r =>
            (r.customerName || '').toLowerCase().includes(term) ||
            (r.ref || '').toLowerCase().includes(term)
        );
    }

    recoveries.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('rso-recovery-count').textContent = `${recoveries.length} recover${recoveries.length === 1 ? 'y' : 'ies'}`;

    if (recoveries.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No recoveries yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = recoveries.map(r => `
        <tr>
            <td>${escapeHtml(r.date)}</td>
            <td>${escapeHtml(r.customerName)}</td>
            <td class="num">${formatCurrency(r.amount)}</td>
            <td>${escapeHtml(r.mode || 'Cash')}</td>
            <td>${escapeHtml(r.note) || '-'}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openRsoRecoveryForm('${r.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteRsoRecovery('${r.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openRsoRecoveryForm(editId = null) {
    const form = $('rso-recovery-form');
    form.reset();
    $('rso-recv-id').value = '';

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : null;

    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-recv-rso-user');
        $('rso-recv-rso-field').classList.remove('hidden');
    } else {
        $('rso-recv-rso-field').classList.add('hidden');
    }

    if (editId) {
        const r = lfFindById(LF_KEYS.RSO_RECOVERIES, editId);
        if (!r) { showToast('Recovery not found.', 'error'); return; }
        $('rso-recovery-modal-title').textContent = 'Edit Recovery';
        $('rso-recv-id').value = r.id;
        $('rso-recv-date').value = r.date;
        if (!isRsoUser()) $('rso-recv-rso-user').value = r.rsoUserId;
        populateRsoRecoveryCustomerDropdown(r.rsoUserId);
        $('rso-recv-customer').value = r.customerId;
        onRsoRecoveryCustomerChange();
        $('rso-recv-amount').value = r.amount.toLocaleString('en-US');
        $('rso-recv-mode').value = r.mode || 'Cash';
        $('rso-recv-note').value = r.note || '';
    } else {
        $('rso-recovery-modal-title').textContent = 'New Recovery';
        $('rso-recv-date').value = new Date().toISOString().slice(0, 10);
        if (rsoUserId) populateRsoRecoveryCustomerDropdown(rsoUserId);
    }

    $('rso-recovery-modal').classList.remove('hidden');
}

function closeRsoRecoveryForm() { $('rso-recovery-modal').classList.add('hidden'); }

function onRsoRecoveryRsoChange() {
    const rsoUserId = $('rso-recv-rso-user').value;
    populateRsoRecoveryCustomerDropdown(rsoUserId);
}

function populateRsoRecoveryCustomerDropdown(rsoUserId) {
    const select = $('rso-recv-customer');
    if (!select) return;
    const customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c => c.rsoUserId === rsoUserId);
    select.innerHTML = '<option value="">Select customer…</option>' +
        customers.map(c => {
            const bal = computeRsoCustomerBalance(c.id);
            return `<option value="${c.id}">${escapeHtml(c.shopName || c.name)} (${formatCurrency(bal.amount)} ${bal.side})</option>`;
        }).join('');
}

function onRsoRecoveryCustomerChange() {
    const customerId = $('rso-recv-customer').value;
    if (!customerId) { $('rso-recv-cust-balance').textContent = ''; return; }
    const bal = computeRsoCustomerBalance(customerId);
    $('rso-recv-cust-balance').textContent = `Outstanding: ${formatCurrency(bal.amount)} ${bal.side}`;
}

async function saveRsoRecovery() {
    const id = $('rso-recv-id').value;
    const date = $('rso-recv-date').value;
    const customerId = $('rso-recv-customer').value;
    const amount = parseAmount($('rso-recv-amount').value);
    const mode = $('rso-recv-mode').value;
    const note = sanitizeInput($('rso-recv-note').value);
    const saveBtn = $('rso-recovery-save-btn');

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : $('rso-recv-rso-user').value;

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!rsoUserId) { showToast('Please select an RSO.', 'warning'); return; }
    if (!customerId) { showToast('Please select a customer.', 'warning'); return; }
    if (amount <= 0) { showToast('Enter an amount greater than 0.', 'warning'); return; }

    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);

    setBtnLoading(saveBtn, true);

    try {
        const record = {
            id: id || undefined,
            rsoUserId, customerId, date, amount, mode, note,
            customerName: customer ? (customer.shopName || customer.name) : '',
            enteredBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.RSO_RECOVERIES, record);

        showToast(id ? 'Recovery updated.' : 'Recovery saved.', 'success');
        closeRsoRecoveryForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save recovery.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteRsoRecovery(id) {
    const r = lfFindById(LF_KEYS.RSO_RECOVERIES, id);
    if (!r) return;
    if (!confirm('Delete this recovery?')) return;
    try {
        await lfDelete(LF_KEYS.RSO_RECOVERIES, id);
        showToast('Recovery deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== RSO DEPOSIT (RSO deposits cash to company) ====================
function renderRsoDepositList(searchTerm = '') {
    const tbody = $('rso-deposit-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let deposits = lfGetAll(LF_KEYS.RSO_DEPOSITS);

    if (isRsoUser()) {
        deposits = deposits.filter(d => d.rsoUserId === getCurrentRsoUserId());
    }

    if (term) {
        deposits = deposits.filter(d =>
            (d.rsoName || '').toLowerCase().includes(term) ||
            (d.bankName || '').toLowerCase().includes(term)
        );
    }

    deposits.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('rso-deposit-count').textContent = `${deposits.length} deposit${deposits.length === 1 ? '' : 's'}`;

    if (deposits.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No deposits yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = deposits.map(d => `
        <tr>
            <td>${escapeHtml(d.date)}</td>
            <td>${escapeHtml(d.rsoName)}</td>
            <td>${escapeHtml(d.bankName)}</td>
            <td class="num">${formatCurrency(d.amount)}</td>
            <td>${escapeHtml(d.note) || '-'}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openRsoDepositForm('${d.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteRsoDeposit('${d.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openRsoDepositForm(editId = null) {
    const form = $('rso-deposit-form');
    form.reset();
    $('rso-dep-id').value = '';

    if (!isRsoUser()) {
        populateRsoUserDropdown('rso-dep-rso-user');
        $('rso-dep-rso-field').classList.remove('hidden');
    } else {
        $('rso-dep-rso-field').classList.add('hidden');
    }

    const bankAccounts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Cash' || a.type === 'Bank');
    $('rso-dep-bank').innerHTML = bankAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)} (${a.type})</option>`).join('');

    if (editId) {
        const d = lfFindById(LF_KEYS.RSO_DEPOSITS, editId);
        if (!d) { showToast('Deposit not found.', 'error'); return; }
        $('rso-deposit-modal-title').textContent = 'Edit Deposit';
        $('rso-dep-id').value = d.id;
        $('rso-dep-date').value = d.date;
        if (!isRsoUser()) $('rso-dep-rso-user').value = d.rsoUserId;
        $('rso-dep-bank').value = d.bankAccountId;
        $('rso-dep-amount').value = d.amount.toLocaleString('en-US');
        $('rso-dep-note').value = d.note || '';
    } else {
        $('rso-deposit-modal-title').textContent = 'New Deposit';
        $('rso-dep-date').value = new Date().toISOString().slice(0, 10);
    }

    $('rso-deposit-modal').classList.remove('hidden');
}

function closeRsoDepositForm() { $('rso-deposit-modal').classList.add('hidden'); }

async function saveRsoDeposit() {
    const id = $('rso-dep-id').value;
    const date = $('rso-dep-date').value;
    const bankAccountId = $('rso-dep-bank').value;
    const amount = parseAmount($('rso-dep-amount').value);
    const note = sanitizeInput($('rso-dep-note').value);
    const saveBtn = $('rso-deposit-save-btn');

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : $('rso-dep-rso-user').value;

    if (!date) { showToast('Please choose a date.', 'warning'); return; }
    if (!rsoUserId) { showToast('Please select an RSO.', 'warning'); return; }
    if (!bankAccountId) { showToast('Please select a Bank/Cash account.', 'warning'); return; }
    if (amount <= 0) { showToast('Enter an amount greater than 0.', 'warning'); return; }

    const rsoUser = lfFindById(LF_KEYS.USERS, rsoUserId);
    const rsoAccount = getRsoAccountForUser(rsoUserId);
    const bankAccount = lfFindById(LF_KEYS.ACCOUNTS, bankAccountId);

    setBtnLoading(saveBtn, true);

    try {
        if (id) await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);

        const depositId = id || generateId();

        const writes = [];
        if (bankAccount) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: depositId, accountId: bankAccountId, date, type: 'RsoDeposit',
                ref: 'RSO-DEP', side: 'Dr', amount,
                note: `Deposit from ${rsoUser ? rsoUser.fullName : 'RSO'}`
            }));
        }
        if (rsoAccount) {
            writes.push(lfUpsert(LF_KEYS.ACCOUNT_LEDGER, {
                invoiceId: depositId, accountId: rsoAccount.id, date, type: 'RsoDeposit',
                ref: 'RSO-DEP', side: 'Cr', amount,
                note: `Cash deposited to ${bankAccount ? bankAccount.title : 'company'}`
            }));
        }
        await Promise.all(writes);

        const record = {
            id: depositId, date, rsoUserId,
            rsoName: rsoUser ? rsoUser.fullName : '',
            bankAccountId, bankName: bankAccount ? bankAccount.title : '',
            amount, note,
            enteredBy: getCurrentUserDisplayName()
        };
        await lfUpsert(LF_KEYS.RSO_DEPOSITS, record);

        showToast(id ? 'Deposit updated.' : 'Deposit saved.', 'success');
        closeRsoDepositForm();
    } catch (e) {
        console.error(e);
        showToast('Could not save deposit.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

async function deleteRsoDeposit(id) {
    const d = lfFindById(LF_KEYS.RSO_DEPOSITS, id);
    if (!d) return;
    if (!confirm('Delete this deposit?')) return;
    try {
        await lfDeleteWhereInvoiceId(LF_KEYS.ACCOUNT_LEDGER, id);
        await lfDelete(LF_KEYS.RSO_DEPOSITS, id);
        showToast('Deposit deleted.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Could not delete.', 'error');
    }
}

// ==================== RSO REPORTS ====================

function renderRsoCustomerLedger() {
    const container = $('rso-rpt-cust-ledger-body');
    if (!container) return;

    const customerId = $('rso-rpt-cust-ledger-customer')?.value;
    if (!customerId) { container.innerHTML = '<p class="hint">Select a customer to view their ledger.</p>'; return; }

    const customer = lfFindById(LF_KEYS.RSO_CUSTOMERS, customerId);
    const opening = customer ? (customer.openingBalance || 0) : 0;

    const entries = [];

    if (opening > 0) {
        entries.push({ date: 'Opening', ref: '-', type: 'Opening Balance', dr: opening, cr: 0 });
    }

    lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.customerId === customerId).forEach(s => {
        entries.push({ date: s.date, ref: s.number, type: 'Sale', dr: s.grandTotal, cr: 0 });
    });

    lfGetAll(LF_KEYS.RSO_RETURNS).filter(r => r.customerId === customerId).forEach(r => {
        entries.push({ date: r.date, ref: r.number, type: 'Return', dr: 0, cr: r.grandTotal });
    });

    lfGetAll(LF_KEYS.RSO_RECOVERIES).filter(r => r.customerId === customerId).forEach(r => {
        entries.push({ date: r.date, ref: r.ref || '-', type: 'Recovery', dr: 0, cr: r.amount });
    });

    entries.sort((a, b) => {
        if (a.date === 'Opening') return -1;
        if (b.date === 'Opening') return 1;
        return a.date.localeCompare(b.date);
    });

    let balance = 0;
    let html = `<table class="data-table"><thead><tr><th>Date</th><th>Ref</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>`;

    entries.forEach(e => {
        balance += e.dr - e.cr;
        html += `<tr><td>${e.date}</td><td>${escapeHtml(e.ref)}</td><td>${e.type}</td><td class="num">${e.dr ? formatCurrency(e.dr) : '-'}</td><td class="num">${e.cr ? formatCurrency(e.cr) : '-'}</td><td class="num">${formatCurrency(Math.abs(balance))} ${balance >= 0 ? 'Dr' : 'Cr'}</td></tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = entries.length ? html : '<p class="hint">No transactions found for this customer.</p>';
}

function renderRsoCustomerOutstanding() {
    const container = $('rso-rpt-outstanding-body');
    if (!container) return;

    let customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS);
    if (isRsoUser()) customers = customers.filter(c => c.rsoUserId === getCurrentRsoUserId());

    let html = `<table class="data-table"><thead><tr><th>Customer</th><th>Area</th><th class="num">Outstanding</th></tr></thead><tbody>`;
    let totalOutstanding = 0;

    customers.forEach(c => {
        const bal = computeRsoCustomerBalance(c.id);
        if (bal.amount > 0 && bal.side === 'Dr') {
            totalOutstanding += bal.amount;
            html += `<tr><td>${escapeHtml(c.shopName || c.name)}</td><td>${escapeHtml(c.area) || '-'}</td><td class="num">${formatCurrency(bal.amount)}</td></tr>`;
        }
    });

    html += `<tr class="statement-total"><td colspan="2"><strong>Total Outstanding</strong></td><td class="num"><strong>${formatCurrency(totalOutstanding)}</strong></td></tr>`;
    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderRsoStockReport() {
    const container = $('rso-rpt-stock-body');
    if (!container) return;

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-rpt-stock-rso')?.value || '');
    if (!rsoUserId) { container.innerHTML = '<p class="hint">Select an RSO to view stock.</p>'; return; }

    const stock = computeRsoStock(rsoUserId);

    let html = `<table class="data-table"><thead><tr><th>Item</th><th class="num">Available Qty</th><th class="num">Rate</th><th class="num">Value</th></tr></thead><tbody>`;
    let totalValue = 0;

    Object.entries(stock).forEach(([itemId, s]) => {
        if (s.qty !== 0) {
            const value = s.qty * s.rate;
            totalValue += value;
            html += `<tr><td>${escapeHtml(s.itemName)}</td><td class="num">${s.qty}</td><td class="num">${formatCurrency(s.rate)}</td><td class="num">${formatCurrency(value)}</td></tr>`;
        }
    });

    html += `<tr class="statement-total"><td colspan="3"><strong>Total Stock Value</strong></td><td class="num"><strong>${formatCurrency(totalValue)}</strong></td></tr>`;
    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderRsoSalesReport() {
    const container = $('rso-rpt-sales-body');
    if (!container) return;

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-rpt-sales-rso')?.value || '');
    const fromDate = $('rso-rpt-sales-from')?.value || '';
    const toDate = $('rso-rpt-sales-to')?.value || '';

    let sales = lfGetAll(LF_KEYS.RSO_SALES);
    if (rsoUserId) sales = sales.filter(s => s.rsoUserId === rsoUserId);
    if (fromDate) sales = sales.filter(s => s.date >= fromDate);
    if (toDate) sales = sales.filter(s => s.date <= toDate);

    sales.sort((a, b) => a.date.localeCompare(b.date));

    let html = `<table class="data-table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="num">Amount</th><th class="num">Paid</th></tr></thead><tbody>`;
    let totalAmount = 0, totalPaid = 0;

    sales.forEach(s => {
        totalAmount += s.grandTotal;
        totalPaid += (s.paidAmount || 0);
        html += `<tr><td>${s.date}</td><td>${escapeHtml(s.number)}</td><td>${escapeHtml(s.customerName)}</td><td class="num">${formatCurrency(s.grandTotal)}</td><td class="num">${formatCurrency(s.paidAmount || 0)}</td></tr>`;
    });

    html += `<tr class="statement-total"><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${formatCurrency(totalAmount)}</strong></td><td class="num"><strong>${formatCurrency(totalPaid)}</strong></td></tr>`;
    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderRsoRecoveryReport() {
    const container = $('rso-rpt-recovery-body');
    if (!container) return;

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-rpt-recovery-rso')?.value || '');
    const fromDate = $('rso-rpt-recovery-from')?.value || '';
    const toDate = $('rso-rpt-recovery-to')?.value || '';

    let recoveries = lfGetAll(LF_KEYS.RSO_RECOVERIES);
    if (rsoUserId) recoveries = recoveries.filter(r => r.rsoUserId === rsoUserId);
    if (fromDate) recoveries = recoveries.filter(r => r.date >= fromDate);
    if (toDate) recoveries = recoveries.filter(r => r.date <= toDate);

    recoveries.sort((a, b) => a.date.localeCompare(b.date));

    let html = `<table class="data-table"><thead><tr><th>Date</th><th>Customer</th><th class="num">Amount</th><th>Mode</th><th>Note</th></tr></thead><tbody>`;
    let total = 0;

    recoveries.forEach(r => {
        total += r.amount;
        html += `<tr><td>${r.date}</td><td>${escapeHtml(r.customerName)}</td><td class="num">${formatCurrency(r.amount)}</td><td>${escapeHtml(r.mode || 'Cash')}</td><td>${escapeHtml(r.note) || '-'}</td></tr>`;
    });

    html += `<tr class="statement-total"><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${formatCurrency(total)}</strong></td><td colspan="2"></td></tr>`;
    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderRsoLedgerReport() {
    const container = $('rso-rpt-rso-ledger-body');
    if (!container) return;

    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-rpt-rso-ledger-rso')?.value || '');
    if (!rsoUserId) { container.innerHTML = '<p class="hint">Select an RSO to view their ledger.</p>'; return; }

    const rsoUser = lfFindById(LF_KEYS.USERS, rsoUserId);
    const stock = computeRsoStock(rsoUserId);

    const loads = lfGetAll(LF_KEYS.RSO_LOADS).filter(l => l.rsoUserId === rsoUserId);
    const sales = lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.rsoUserId === rsoUserId);
    const returns = lfGetAll(LF_KEYS.RSO_RETURNS).filter(r => r.rsoUserId === rsoUserId);
    const recoveries = lfGetAll(LF_KEYS.RSO_RECOVERIES).filter(r => r.rsoUserId === rsoUserId);
    const deposits = lfGetAll(LF_KEYS.RSO_DEPOSITS).filter(d => d.rsoUserId === rsoUserId);

    const totalLoads = loads.reduce((s, l) => s + l.grandTotal, 0);
    const totalSales = sales.reduce((s, sale) => s + sale.grandTotal, 0);
    const totalReturns = returns.reduce((s, r) => s + r.grandTotal, 0);
    const totalRecoveries = recoveries.reduce((s, r) => s + r.amount, 0);
    const totalDeposits = deposits.reduce((s, d) => s + d.amount, 0);

    let stockValue = 0;
    Object.values(stock).forEach(s => { stockValue += s.qty * s.rate; });

    const outstandingCash = totalRecoveries - totalDeposits;

    let html = `<div class="statement-section"><h3>RSO Summary: ${escapeHtml(rsoUser ? rsoUser.fullName : '')}</h3>`;
    html += `<table class="data-table"><tbody>`;
    html += `<tr><td>Stock Received (Loads)</td><td class="num">${formatCurrency(totalLoads)}</td></tr>`;
    html += `<tr><td>Total Sales</td><td class="num">${formatCurrency(totalSales)}</td></tr>`;
    html += `<tr><td>Total Sales Returns</td><td class="num">${formatCurrency(totalReturns)}</td></tr>`;
    html += `<tr><td>Net Sales</td><td class="num"><strong>${formatCurrency(totalSales - totalReturns)}</strong></td></tr>`;
    html += `<tr><td>Current Stock Value</td><td class="num">${formatCurrency(stockValue)}</td></tr>`;
    html += `<tr><td>Total Cash Collected</td><td class="num">${formatCurrency(totalRecoveries)}</td></tr>`;
    html += `<tr><td>Amount Deposited</td><td class="num">${formatCurrency(totalDeposits)}</td></tr>`;
    html += `<tr class="statement-total"><td><strong>Outstanding Cash</strong></td><td class="num"><strong>${formatCurrency(Math.abs(outstandingCash))} ${outstandingCash >= 0 ? 'Dr' : 'Cr'}</strong></td></tr>`;
    html += `</tbody></table></div>`;

    container.innerHTML = html;
}

function renderRsoDailySalesReport() {
    const container = $('rso-rpt-daily-body');
    if (!container) return;

    const reportDate = $('rso-rpt-daily-date')?.value || new Date().toISOString().slice(0, 10);
    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : ($('rso-rpt-daily-rso')?.value || '');

    let sales = lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.date === reportDate);
    if (rsoUserId) sales = sales.filter(s => s.rsoUserId === rsoUserId);

    let recoveries = lfGetAll(LF_KEYS.RSO_RECOVERIES).filter(r => r.date === reportDate);
    if (rsoUserId) recoveries = recoveries.filter(r => r.rsoUserId === rsoUserId);

    let html = `<h3>Daily Summary: ${reportDate}</h3>`;
    html += `<table class="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th class="num">Amount</th><th class="num">Paid</th></tr></thead><tbody>`;

    let totalSales = 0, totalPaid = 0;
    sales.forEach(s => {
        totalSales += s.grandTotal;
        totalPaid += (s.paidAmount || 0);
        html += `<tr><td>${escapeHtml(s.number)}</td><td>${escapeHtml(s.customerName)}</td><td class="num">${formatCurrency(s.grandTotal)}</td><td class="num">${formatCurrency(s.paidAmount || 0)}</td></tr>`;
    });

    html += `<tr class="statement-total"><td colspan="2"><strong>Total Sales</strong></td><td class="num"><strong>${formatCurrency(totalSales)}</strong></td><td class="num"><strong>${formatCurrency(totalPaid)}</strong></td></tr>`;
    html += `</tbody></table>`;

    const totalRecovery = recoveries.reduce((sum, r) => sum + r.amount, 0);
    html += `<p style="margin-top:1rem"><strong>Total Recoveries:</strong> ${formatCurrency(totalRecovery)}</p>`;

    container.innerHTML = html;
}

function initRsoReportCustomerDropdown() {
    const rsoUserId = isRsoUser() ? getCurrentRsoUserId() : '';
    const select = $('rso-rpt-cust-ledger-customer');
    if (!select) return;
    let customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS);
    if (rsoUserId) customers = customers.filter(c => c.rsoUserId === rsoUserId);
    select.innerHTML = '<option value="">Select customer…</option>' +
        customers.map(c => `<option value="${c.id}">${escapeHtml(c.shopName || c.name)}</option>`).join('');
}

// ==================== RSO DASHBOARD (for RSO users) ====================
function renderRsoDashboard() {
    const rsoUserId = getCurrentRsoUserId();
    if (!rsoUserId) return;

    const stock = computeRsoStock(rsoUserId);
    let stockValue = 0;
    Object.values(stock).forEach(s => { stockValue += s.qty * s.rate; });

    const sales = lfGetAll(LF_KEYS.RSO_SALES).filter(s => s.rsoUserId === rsoUserId);
    const recoveries = lfGetAll(LF_KEYS.RSO_RECOVERIES).filter(r => r.rsoUserId === rsoUserId);
    const deposits = lfGetAll(LF_KEYS.RSO_DEPOSITS).filter(d => d.rsoUserId === rsoUserId);
    const customers = lfGetAll(LF_KEYS.RSO_CUSTOMERS).filter(c => c.rsoUserId === rsoUserId);

    const totalSales = sales.reduce((s, sale) => s + sale.grandTotal, 0);
    const totalRecoveries = recoveries.reduce((s, r) => s + r.amount, 0);
    const totalDeposits = deposits.reduce((s, d) => s + d.amount, 0);
    const cashInHand = totalRecoveries - totalDeposits;

    let totalOutstanding = 0;
    customers.forEach(c => {
        const bal = computeRsoCustomerBalance(c.id);
        if (bal.side === 'Dr') totalOutstanding += bal.amount;
    });

    const el = $('rso-dash-stats');
    if (el) {
        el.innerHTML = `
            <div class="rso-stat-card"><span class="rso-stat-label">Current Stock</span><span class="rso-stat-value">${formatCurrency(stockValue)}</span></div>
            <div class="rso-stat-card"><span class="rso-stat-label">Total Sales</span><span class="rso-stat-value">${formatCurrency(totalSales)}</span></div>
            <div class="rso-stat-card"><span class="rso-stat-label">Cash in Hand</span><span class="rso-stat-value">${formatCurrency(Math.abs(cashInHand))}</span></div>
            <div class="rso-stat-card"><span class="rso-stat-label">Outstanding</span><span class="rso-stat-value">${formatCurrency(totalOutstanding)}</span></div>
            <div class="rso-stat-card"><span class="rso-stat-label">Customers</span><span class="rso-stat-value">${customers.length}</span></div>
            <div class="rso-stat-card"><span class="rso-stat-label">Deposited</span><span class="rso-stat-value">${formatCurrency(totalDeposits)}</span></div>
        `;
    }
}

// ==================== INIT RSO REPORT DROPDOWNS ====================
function initRsoReportDropdowns() {
    initRsoReportCustomerDropdown();
    const rsoDropdowns = ['rso-rpt-stock-rso', 'rso-rpt-sales-rso', 'rso-rpt-recovery-rso', 'rso-rpt-rso-ledger-rso', 'rso-rpt-daily-rso'];
    if (isRsoUser()) {
        rsoDropdowns.forEach(id => {
            const el = $(id);
            if (el) el.closest('.field')?.classList.add('hidden');
        });
    } else {
        rsoDropdowns.forEach(id => populateRsoUserDropdown(id));
    }
    const dateEl = $('rso-rpt-daily-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
}

// ==================== RSO NAV VISIBILITY ====================
function applyRsoNavVisibility() {
    const rso = isRsoUser();
    document.querySelectorAll('.nav-group[data-rso-admin]').forEach(g => {
        g.classList.toggle('hidden', rso);
    });
    document.querySelectorAll('.nav-group[data-rso-only]').forEach(g => {
        g.classList.toggle('hidden', !rso);
    });
    document.querySelectorAll('.dash-tab[data-rso-admin]').forEach(t => {
        t.classList.toggle('hidden', rso);
    });
    document.querySelectorAll('.dash-tab[data-rso-only]').forEach(t => {
        t.classList.toggle('hidden', !rso);
    });

    if (rso) {
        document.querySelectorAll('.nav-group[data-rso-shared]').forEach(g => g.classList.remove('hidden'));
    }
}
