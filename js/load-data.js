/**
 * TeleFlow — Load Data (Excel Import)
 *
 * Bulk import master data from .xlsx files into Firestore.
 * Categories: Accounts, Items, RSO Agents, BTL Agents, RSO Customers.
 */

const LOAD_DATA_CONFIGS = {
    accounts: {
        title: 'Accounts',
        columns: ['Title', 'Type', 'Opening Balance', 'Dr/Cr', 'Phone', 'City'],
        required: ['Title', 'Type'],
        validTypes: ['Customer', 'Supplier', 'Customer/Supplier', 'Employee/RSO', 'Employee/BTL', 'Cash', 'Bank', 'Income', 'Expense', 'Asset', 'Liability'],
        template: [
            ['Title', 'Type', 'Opening Balance', 'Dr/Cr', 'Phone', 'City'],
            ['Ali General Store', 'Customer', 5000, 'Dr', '0333-1234567', 'Karachi'],
            ['Mobilink Distributor', 'Supplier', 0, 'Cr', '0300-9876543', 'Lahore'],
            ['Habib Bank', 'Bank', 50000, 'Dr', '', 'Karachi'],
            ['Petty Cash', 'Cash', 10000, 'Dr', '', '']
        ]
    },
    items: {
        title: 'Items Catalog',
        columns: ['Item Name', 'Purchase Price', 'Sale Price'],
        required: ['Item Name'],
        template: [
            ['Item Name', 'Purchase Price', 'Sale Price'],
            ['AWAMI SIM', 200, 0],
            ['Super Card 100', 95, 100],
            ['Super Card 500', 475, 500]
        ]
    },
    rso: {
        title: 'RSO Agents',
        columns: ['Full Name', 'Mobile', 'CNIC', 'Area'],
        required: ['Full Name'],
        template: [
            ['Full Name', 'Mobile', 'CNIC', 'Area'],
            ['Ahmed Ali', '0333-1234567', '42101-1234567-1', 'Nazimabad'],
            ['Bilal Khan', '0300-9876543', '42201-7654321-3', 'Gulshan']
        ]
    },
    btl: {
        title: 'BTL Agents',
        columns: ['Agent Name', 'Mobile', 'CNIC', 'Area / Stall'],
        required: ['Agent Name'],
        template: [
            ['Agent Name', 'Mobile', 'CNIC', 'Area / Stall'],
            ['Faisal Hussain', '0312-5551234', '42101-3456789-1', 'Tariq Road Stall'],
            ['Usman Shah', '0321-4449876', '', 'Saddar Stall']
        ]
    },
    rso_customers: {
        title: 'RSO Customers',
        columns: ['Customer Name', 'Shop Name', 'Mobile', 'Area', 'RSO Name', 'Credit Limit'],
        required: ['Customer Name', 'RSO Name'],
        template: [
            ['Customer Name', 'Shop Name', 'Mobile', 'Area', 'RSO Name', 'Credit Limit'],
            ['Fauji', 'Fauji Telecom', '0333-1112222', 'Block 3', 'Ahmed Ali', 5000],
            ['Rafeeque shaikh', 'Rafeeque Mobile', '0300-3334444', 'Liaquatabad', 'Ahmed Ali', 10000]
        ]
    }
};

let _loadDataCategory = null;
let _loadDataParsed = [];
let _loadDataErrors = 0;

function openLoadDataImport(category) {
    _loadDataCategory = category;
    _loadDataParsed = [];
    _loadDataErrors = 0;
    const config = LOAD_DATA_CONFIGS[category];
    $('load-data-modal-title').textContent = `Import ${config.title}`;
    $('load-data-upload-zone').classList.remove('hidden');
    $('load-data-preview').classList.add('hidden');
    $('load-data-import-btn').classList.add('hidden');
    $('load-data-file').value = '';
    $('load-data-modal').classList.remove('hidden');
}

function closeLoadDataImport() {
    $('load-data-modal').classList.add('hidden');
    _loadDataCategory = null;
    _loadDataParsed = [];
}

function resetLoadDataImport() {
    $('load-data-upload-zone').classList.remove('hidden');
    $('load-data-preview').classList.add('hidden');
    $('load-data-import-btn').classList.add('hidden');
    $('load-data-file').value = '';
    _loadDataParsed = [];
    _loadDataErrors = 0;
}

function downloadLoadDataTemplate() {
    const config = LOAD_DATA_CONFIGS[_loadDataCategory];
    const ws = XLSX.utils.aoa_to_sheet(config.template);

    const colWidths = config.columns.map(c => ({ wch: Math.max(c.length + 4, 18) }));
    ws['!cols'] = colWidths;

    if (_loadDataCategory === 'accounts') {
        const typeCol = config.columns.indexOf('Type');
        const drcrCol = config.columns.indexOf('Dr/Cr');
        const typeList = '"' + config.validTypes.join(',') + '"';
        ws['!dataValidation'] = [];
        if (typeCol >= 0) {
            const typeColLetter = String.fromCharCode(65 + typeCol);
            ws['!dataValidation'].push({
                sqref: `${typeColLetter}2:${typeColLetter}1000`,
                type: 'list', operator: 'equal', formula1: typeList,
                showErrorMessage: true, errorTitle: 'Invalid Type',
                error: 'Please select a valid account type from the dropdown.'
            });
        }
        if (drcrCol >= 0) {
            const drcrColLetter = String.fromCharCode(65 + drcrCol);
            ws['!dataValidation'].push({
                sqref: `${drcrColLetter}2:${drcrColLetter}1000`,
                type: 'list', operator: 'equal', formula1: '"Dr,Cr"',
                showErrorMessage: true, errorTitle: 'Invalid Side',
                error: 'Please select Dr or Cr.'
            });
        }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.title);
    XLSX.writeFile(wb, `${_loadDataCategory}_template.xlsx`);
}

function onLoadDataFileSelected(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (raw.length === 0) {
                showToast('The Excel file is empty.', 'warning');
                return;
            }

            parseLoadData(raw);
        } catch (err) {
            console.error(err);
            showToast('Could not read the Excel file.', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseLoadData(raw) {
    const config = LOAD_DATA_CONFIGS[_loadDataCategory];
    const headers = config.columns;

    const fileHeaders = Object.keys(raw[0]);
    const colMap = {};
    headers.forEach(h => {
        const match = fileHeaders.find(fh => fh.trim().toLowerCase() === h.toLowerCase());
        colMap[h] = match || null;
    });

    const missingRequired = config.required.filter(r => !colMap[r]);
    if (missingRequired.length > 0) {
        showToast(`Missing required columns: ${missingRequired.join(', ')}`, 'error');
        return;
    }

    _loadDataParsed = [];
    _loadDataErrors = 0;
    let duplicates = 0;

    const existingNames = _getExistingNames();

    raw.forEach((row, idx) => {
        const mapped = {};
        let rowError = null;

        headers.forEach(h => {
            const key = colMap[h];
            mapped[h] = key ? ('' + (row[key] ?? '')).trim() : '';
        });

        config.required.forEach(r => {
            if (!mapped[r]) rowError = `Missing ${r}`;
        });

        if (_loadDataCategory === 'accounts') {
            if (mapped['Type'] && !config.validTypes.includes(mapped['Type'])) {
                rowError = `Invalid type: ${mapped['Type']}`;
            }
            const side = (mapped['Dr/Cr'] || '').trim().toLowerCase();
            if (side && side !== 'dr' && side !== 'cr') {
                rowError = `Invalid Dr/Cr: ${mapped['Dr/Cr']} (use Dr or Cr)`;
            }
        }

        let isDuplicate = false;
        const primaryKey = mapped[headers[0]] || '';
        if (primaryKey && existingNames.has(primaryKey.toLowerCase())) {
            isDuplicate = true;
            duplicates++;
        }

        _loadDataParsed.push({
            data: mapped,
            error: rowError,
            duplicate: isDuplicate,
            rowNum: idx + 2
        });

        if (rowError) _loadDataErrors++;
    });

    renderLoadDataPreview(headers, duplicates);
}

function _getExistingNames() {
    const names = new Set();
    switch (_loadDataCategory) {
        case 'accounts':
            lfGetAll(LF_KEYS.ACCOUNTS).forEach(a => names.add((a.title || '').toLowerCase()));
            break;
        case 'items':
            lfGetAll(LF_KEYS.ITEMS).forEach(i => names.add((i.name || '').toLowerCase()));
            break;
        case 'rso':
            lfGetAll(LF_KEYS.USERS).filter(u => u.role === 'rso').forEach(u => names.add((u.fullName || '').toLowerCase()));
            break;
        case 'btl':
            lfGetAll(LF_KEYS.BTL_AGENTS).forEach(a => names.add((a.name || '').toLowerCase()));
            break;
        case 'rso_customers':
            lfGetAll(LF_KEYS.RSO_CUSTOMERS).forEach(c => names.add((c.name || '').toLowerCase()));
            break;
    }
    return names;
}

function renderLoadDataPreview(headers, duplicates) {
    $('load-data-upload-zone').classList.add('hidden');
    $('load-data-preview').classList.remove('hidden');

    const validCount = _loadDataParsed.length - _loadDataErrors;
    $('load-data-count').textContent = `${_loadDataParsed.length} rows (${validCount} valid)`;
    const errPill = $('load-data-errors');
    if (_loadDataErrors > 0 || duplicates > 0) {
        const parts = [];
        if (_loadDataErrors > 0) parts.push(`${_loadDataErrors} error${_loadDataErrors > 1 ? 's' : ''}`);
        if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''}`);
        errPill.textContent = parts.join(', ');
        errPill.style.display = '';
    } else {
        errPill.style.display = 'none';
    }

    const thead = $('load-data-thead');
    thead.innerHTML = '<tr><th>#</th>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '<th>Status</th></tr>';

    const tbody = $('load-data-tbody');
    tbody.innerHTML = _loadDataParsed.map((p, i) => {
        let cls = 'load-data-row-ok';
        let status = '<span style="color:var(--credit)">OK</span>';
        if (p.error) {
            cls = 'load-data-row-err';
            status = `<span style="color:var(--danger)">${escapeHtml(p.error)}</span>`;
        } else if (p.duplicate) {
            cls = 'load-data-row-dup';
            status = '<span style="color:var(--warning,#e6a200)">Duplicate</span>';
        }
        return `<tr class="${cls}">
            <td>${p.rowNum}</td>
            ${headers.map(h => `<td>${escapeHtml(p.data[h])}</td>`).join('')}
            <td>${status}</td>
        </tr>`;
    }).join('');

    if (validCount > 0) {
        $('load-data-import-btn').classList.remove('hidden');
    }
}

async function executeLoadDataImport() {
    const config = LOAD_DATA_CONFIGS[_loadDataCategory];
    const validRows = _loadDataParsed.filter(p => !p.error && !p.duplicate);

    if (validRows.length === 0) {
        showToast('No valid rows to import.', 'warning');
        return;
    }

    const btn = $('load-data-import-btn');
    setBtnLoading(btn, true);

    try {
        let imported = 0;
        const batchId = 'import_' + Date.now();

        for (const row of validRows) {
            const d = row.data;
            switch (_loadDataCategory) {
                case 'accounts':
                    await _importAccount(d, batchId);
                    break;
                case 'items':
                    await _importItem(d, batchId);
                    break;
                case 'rso':
                    await _importRso(d, batchId);
                    break;
                case 'btl':
                    await _importBtl(d, batchId);
                    break;
                case 'rso_customers':
                    await _importRsoCustomer(d, batchId);
                    break;
            }
            imported++;
        }

        showToast(`Successfully imported ${imported} ${config.title.toLowerCase()}.`, 'success');
        closeLoadDataImport();
    } catch (err) {
        console.error(err);
        showToast('Import failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
        setBtnLoading(btn, false);
    }
}

async function _importAccount(d, batchId) {
    const id = generateId();
    const side = (d['Dr/Cr'] || '').trim();
    const openingSide = (side.toLowerCase() === 'cr') ? 'Cr' : 'Dr';
    await lfUpsert(LF_KEYS.ACCOUNTS, {
        id,
        title: d['Title'],
        type: d['Type'],
        openingAmount: parseFloat((d['Opening Balance'] || '0').toString().replace(/,/g, '')) || 0,
        openingSide,
        phone: d['Phone'] || '',
        city: d['City'] || '',
        importBatch: batchId
    });
}

async function _importItem(d, batchId) {
    const id = generateId();
    await lfUpsert(LF_KEYS.ITEMS, {
        id,
        name: d['Item Name'],
        purchasePrice: parseFloat((d['Purchase Price'] || '0').toString().replace(/,/g, '')) || 0,
        salePrice: parseFloat((d['Sale Price'] || '0').toString().replace(/,/g, '')) || 0,
        importBatch: batchId
    });
}

async function _importRso(d, batchId) {
    const userId = generateId();
    await lfUpsert(LF_KEYS.USERS, {
        id: userId,
        fullName: d['Full Name'],
        role: 'rso',
        mobile: d['Mobile'] || '',
        cnic: d['CNIC'] || '',
        area: d['Area'] || '',
        importBatch: batchId
    });

    await lfUpsert(LF_KEYS.ACCOUNTS, {
        id: 'rsoacc_' + userId,
        title: d['Full Name'],
        type: 'Employee/RSO',
        linkedUserId: userId,
        openingAmount: 0, openingSide: 'Dr',
        importBatch: batchId
    });
}

async function _importBtl(d, batchId) {
    const agentId = generateId();
    await lfUpsert(LF_KEYS.BTL_AGENTS, {
        id: agentId,
        name: d['Agent Name'],
        mobile: d['Mobile'] || '',
        cnic: d['CNIC'] || '',
        area: d['Area / Stall'] || '',
        importBatch: batchId
    });

    await lfUpsert(LF_KEYS.ACCOUNTS, {
        id: 'btlacc_' + agentId,
        title: d['Agent Name'],
        type: 'Employee/BTL',
        linkedUserId: agentId,
        openingAmount: 0, openingSide: 'Dr',
        importBatch: batchId
    });
}

async function _importRsoCustomer(d, batchId) {
    const rsoName = (d['RSO Name'] || '').trim();
    const rsoUser = lfGetAll(LF_KEYS.USERS).find(u => u.role === 'rso' && (u.fullName || '').toLowerCase() === rsoName.toLowerCase());

    if (!rsoUser) {
        throw new Error(`RSO "${rsoName}" not found. Import RSO agents first.`);
    }

    const id = generateId();
    await lfUpsert(LF_KEYS.RSO_CUSTOMERS, {
        id,
        name: d['Customer Name'],
        shopName: d['Shop Name'] || '',
        mobile: d['Mobile'] || '',
        area: d['Area'] || '',
        rsoUserId: rsoUser.id,
        creditLimit: parseFloat((d['Credit Limit'] || '0').toString().replace(/,/g, '')) || 0,
        openingBalance: 0,
        customerType: 'Retailer',
        source: 'Office',
        importBatch: batchId
    });
}

// Drag-and-drop support
document.addEventListener('DOMContentLoaded', () => {
    const zone = document.getElementById('load-data-upload-zone');
    if (!zone) return;

    zone.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') $('load-data-file').click();
    });

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
            const input = $('load-data-file');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            onLoadDataFileSelected(input);
        } else {
            showToast('Please drop an Excel (.xlsx) file.', 'warning');
        }
    });
});
