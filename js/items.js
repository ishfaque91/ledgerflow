/**
 * LedgerFlow - Items module (Management > Add/Edit Items)
 * Deliberately has no opening-quantity field: stock only ever moves
 * through Purchase / Sale / Purchase Return / Sale Return entries, so
 * every unit in the Item Ledger can be traced back to a real invoice.
 */

function renderItemList(searchTerm = '') {
    const tbody = $('item-table-body');
    if (!tbody) return;

    const term = (searchTerm || '').trim().toLowerCase();
    let items = lfGetAll(LF_KEYS.ITEMS);

    if (term) {
        items = items.filter(i =>
            (i.name || '').toLowerCase().includes(term) ||
            (i.category || '').toLowerCase().includes(term)
        );
    }

    items.sort((a, b) => a.name.localeCompare(b.name));
    $('item-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    // Keep the category datalist fresh so repeat categories autocomplete
    const categories = [...new Set(lfGetAll(LF_KEYS.ITEMS).map(i => i.category).filter(Boolean))];
    const dataList = $('item-category-list');
    if (dataList) dataList.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');

    if (items.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No items yet — click "New Item" to add your first one.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(i => `
        <tr>
            <td><strong>${escapeHtml(i.name)}</strong></td>
            <td>${escapeHtml(i.category) || '-'}</td>
            <td>${escapeHtml(i.unit) || '-'}</td>
            <td class="num">${formatCurrency(i.purchasePrice)}</td>
            <td class="num">${formatCurrency(i.salePrice)}</td>
            <td class="num">${i.tax ? i.tax + '%' : '-'}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-outline-text" onclick="openItemForm('${i.id}')">Edit</button>
                    <button class="btn-danger-text" onclick="deleteItem('${i.id}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openItemForm(id = null) {
    const modal = $('item-modal');
    const form = $('item-form');
    form.reset();
    $('item-id').value = '';

    if (id) {
        const item = lfFindById(LF_KEYS.ITEMS, id);
        if (!item) { showToast('Item not found.', 'error'); return; }

        $('item-modal-title').textContent = 'Edit Item';
        $('item-id').value = item.id;
        $('item-name').value = item.name;
        $('item-category').value = item.category || '';
        $('item-unit').value = item.unit || 'Pcs';
        $('item-purchase-price').value = item.purchasePrice ? item.purchasePrice.toLocaleString('en-US') : '';
        $('item-sale-price').value = item.salePrice ? item.salePrice.toLocaleString('en-US') : '';
        $('item-tax').value = item.tax || '';
        $('item-hsn').value = item.hsn || '';
    } else {
        $('item-modal-title').textContent = 'New Item';
    }

    modal.classList.remove('hidden');
    setTimeout(() => $('item-name')?.focus(), 80);
}

function closeItemForm() {
    $('item-modal').classList.add('hidden');
}

async function saveItem() {
    const id = $('item-id').value;
    const name = sanitizeInput($('item-name').value);
    const category = sanitizeInput($('item-category').value);
    const unit = $('item-unit').value;
    const purchasePrice = parseAmount($('item-purchase-price').value);
    const salePrice = parseAmount($('item-sale-price').value);
    const tax = parseAmount($('item-tax').value);
    const hsn = sanitizeInput($('item-hsn').value);
    const saveBtn = $('item-save-btn');

    if (!hasRight('MANAGEMENT', 'Add/Edit Items', 'Edit')) {
        showToast("You don't have permission to save items.", 'warning');
        return;
    }
    if (!name) { showToast('Please enter the item name.', 'warning'); $('item-name').focus(); return; }

    const duplicate = lfGetAll(LF_KEYS.ITEMS).find(i => i.name.trim().toLowerCase() === name.toLowerCase() && i.id !== id);
    if (duplicate) { showToast('An item with this exact name already exists.', 'error'); $('item-name').focus(); return; }

    if (purchasePrice < 0 || salePrice < 0 || tax < 0) {
        showToast('Prices and tax can\'t be negative.', 'warning');
        return;
    }

    setBtnLoading(saveBtn, true);

    try {
        await lfUpsert(LF_KEYS.ITEMS, { id: id || undefined, name, category, unit, purchasePrice, salePrice, tax, hsn });
        showToast(id ? 'Item updated.' : 'Item created.', 'success');
        logActivity(id ? 'Updated' : 'Created', 'Item', name);
        closeItemForm();
    } catch (e) {
        console.error(e);
        showToast('Something went wrong while saving.', 'error');
    } finally {
        setBtnLoading(saveBtn, false);
    }
}

function deleteItem(id) {
    const item = lfFindById(LF_KEYS.ITEMS, id);
    if (!item) return;
    if (!hasRight('MANAGEMENT', 'Add/Edit Items', 'Edit')) {
        showToast("You don't have permission to delete items.", 'warning');
        return;
    }
    // Same reasoning as deleteAccount(): an item with stock history would
    // silently disappear from Stock Report / Item Ledger totals if deleted.
    const usageCount = lfGetAll(LF_KEYS.ITEM_LEDGER).filter(e => e.itemId === id).length;
    if (usageCount > 0) {
        showToast(`Can't delete "${item.name}" — it has ${usageCount} stock ${usageCount === 1 ? 'entry' : 'entries'} from past transactions. Deleting it would break your stock reports.`, 'error', 7000);
        return;
    }
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    lfDelete(LF_KEYS.ITEMS, id);
    showToast('Item deleted.', 'success');
    logActivity('Deleted', 'Item', item.name);
    renderItemList($('item-search')?.value || '');
}
