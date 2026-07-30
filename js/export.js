/**
 * LedgerFlow - Export engine (Print / PDF / Excel).
 *
 * One generic pipeline reused by every report, instead of writing custom
 * export code 13 times over:
 *
 *  1. extractReportRows() reads whatever is CURRENTLY ON SCREEN — either
 *     an actual <table>, or a set of .statement-row/.totals-row divs (used
 *     by Balance Sheet, Profit & Loss, Profit on Sale) — and turns it into
 *     a plain 2D array of text.
 *  2. exportReportToPDF() / exportReportToExcel() build a file from that
 *     same array, so whatever the person sees on screen is exactly what
 *     ends up in the download.
 *  3. printCurrentReport() just uses the browser's own print dialog, with
 *     CSS (see style.css @media print) that hides everything except the
 *     report itself.
 */

function extractReportRows(containerIds) {
    const ids = Array.isArray(containerIds) ? containerIds : [containerIds];
    const rows = [];

    ids.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;

        const table = container.tagName === 'TABLE'
            ? container
            : (container.closest('table') || container.querySelector('table'));

        if (table) {
            table.querySelectorAll('tr').forEach(tr => {
                const cells = [...tr.children].map(cell => cell.innerText.trim());
                if (cells.length) rows.push(cells);
            });
        } else {
            container.querySelectorAll('.statement-row, .dash-invoice-row').forEach(rowEl => {
                const cells = [...rowEl.children].map(el => el.innerText.trim());
                if (cells.length) rows.push(cells);
            });
        }
    });

    return rows;
}

function exportReportToPDF(containerIds, title) {
    const rows = extractReportRows(containerIds);
    if (!rows.length) { showToast('Nothing to export yet.', 'warning'); return; }

    const { jsPDF } = window.jspdf;
    const wide = rows[0].length > 5;
    const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait' });

    doc.setFontSize(14);
    doc.text(title, 14, 15);
    doc.setFontSize(9);
    doc.text(new Date().toLocaleDateString('en-GB'), 14, 21);

    doc.autoTable({
        body: rows,
        startY: 26,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [13, 125, 140] }
    });

    doc.save(`${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    showToast('PDF downloaded.', 'success');
}

function exportReportToExcel(containerIds, title) {
    const rows = extractReportRows(containerIds);
    if (!rows.length) { showToast('Nothing to export yet.', 'warning'); return; }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${title.replace(/[^a-z0-9]+/gi, '_')}.xlsx`);
    showToast('Excel file downloaded.', 'success');
}

function printCurrentReport() {
    window.print();
}

// ==================== SHARED REPORT FILTER MODAL ====================
// One modal, reused by every report — which fields it shows (Account,
// Item, Cash Account, a date range, or an "as of" date) is driven by this
// config, and submitting it fills in that report's own controls and runs
// its existing render function.
const REPORT_FILTER_CONFIG = {
    'page-chart-of-accounts': { title: 'Chart of Accounts', fields: [] },
    'page-account-balances': { title: 'Account Balances', fields: [] },
    'page-account-ledger': { title: 'Account Ledger', fields: ['account', 'dateRange'] },
    'page-load-ledger': { title: 'Load Ledger', fields: ['dateRange'] },
    'page-item-ledger': { title: 'Item Ledger', fields: ['item', 'dateRange'] },
    'page-stock-report': { title: 'Stock Report', fields: [] },
    'page-cash-book': { title: 'Cash Book', fields: ['cashAccount', 'dateRange'] },
    'page-sale-report': { title: 'Sale Invoices Report', fields: ['dateRange'] },
    'page-purchase-report': { title: 'Purchase Invoices Report', fields: ['dateRange'] },
    'page-trial-balance': { title: 'Trial Balance', fields: ['asOf'] },
    'page-balance-sheet': { title: 'Balance Sheet', fields: ['asOf'] },
    'page-profit-on-sale': { title: 'Profit on Sale', fields: ['dateRange'] },
    'page-profit-loss': { title: 'Profit & Loss', fields: ['dateRange'] }
};

let currentReportFilterPageId = null;

function openReportFilterModal(pageId) {
    const config = REPORT_FILTER_CONFIG[pageId];
    if (!config) return;
    currentReportFilterPageId = pageId;

    $('rf-modal-title').textContent = config.title;
    ['rf-field-account', 'rf-field-item', 'rf-field-cash-account', 'rf-field-date-range', 'rf-field-as-of', 'rf-no-filter-note']
        .forEach(id => $(id).classList.add('hidden'));

    if (config.fields.includes('account')) {
        $('rf-field-account').classList.remove('hidden');
        const accounts = lfGetAll(LF_KEYS.ACCOUNTS).sort((a, b) => a.title.localeCompare(b.title));
        $('rf-account').innerHTML = '<option value="">Select an account…</option>' +
            accounts.map(a => `<option value="${a.id}">${escapeHtml(a.title)} (${a.type})</option>`).join('');
    }
    if (config.fields.includes('item')) {
        $('rf-field-item').classList.remove('hidden');
        const items = lfGetAll(LF_KEYS.ITEMS).sort((a, b) => a.name.localeCompare(b.name));
        $('rf-item').innerHTML = '<option value="">Select an item…</option>' +
            items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
    }
    if (config.fields.includes('cashAccount')) {
        $('rf-field-cash-account').classList.remove('hidden');
        const accts = lfGetAll(LF_KEYS.ACCOUNTS).filter(a => a.type === 'Cash' || a.type === 'Bank').sort((a, b) => a.title.localeCompare(b.title));
        $('rf-cash-account').innerHTML = '<option value="">Select an account…</option>' +
            accts.map(a => `<option value="${a.id}">${escapeHtml(a.title)} (${a.type})</option>`).join('');
    }
    if (config.fields.includes('dateRange')) {
        $('rf-field-date-range').classList.remove('hidden');
        $('rf-date-from').value = '';
        $('rf-date-to').value = '';
    }
    if (config.fields.includes('asOf')) {
        $('rf-field-as-of').classList.remove('hidden');
        $('rf-as-of').value = new Date().toISOString().slice(0, 10);
    }
    if (config.fields.length === 0) {
        $('rf-no-filter-note').classList.remove('hidden');
    }

    $('report-filter-modal').classList.remove('hidden');
}

function closeReportFilterModal() {
    $('report-filter-modal').classList.add('hidden');
}

function submitReportFilter() {
    const pageId = currentReportFilterPageId;
    const config = REPORT_FILTER_CONFIG[pageId];

    if (config.fields.includes('account') && !$('rf-account').value) {
        showToast('Please select an account.', 'warning'); return;
    }
    if (config.fields.includes('item') && !$('rf-item').value) {
        showToast('Please select an item.', 'warning'); return;
    }
    if (config.fields.includes('cashAccount') && !$('rf-cash-account').value) {
        showToast('Please select a Cash/Bank account.', 'warning'); return;
    }
    if (config.fields.includes('asOf') && !$('rf-as-of').value) {
        showToast('Please choose a date.', 'warning'); return;
    }

    switch (pageId) {
        case 'page-chart-of-accounts':
            initChartOfAccountsPage();
            break;
        case 'page-account-balances':
            initAccountBalancesPage();
            break;
        case 'page-account-ledger':
            initAccountLedgerPage($('rf-account').value);
            $('al-date-from').value = $('rf-date-from').value;
            $('al-date-to').value = $('rf-date-to').value;
            renderAccountLedgerReport();
            break;
        case 'page-load-ledger':
            $('ll-date-from').value = $('rf-date-from').value;
            $('ll-date-to').value = $('rf-date-to').value;
            renderLoadLedgerReport();
            break;
        case 'page-item-ledger':
            initItemLedgerPage($('rf-item').value);
            $('il-date-from').value = $('rf-date-from').value;
            $('il-date-to').value = $('rf-date-to').value;
            renderItemLedgerReport();
            break;
        case 'page-stock-report':
            initStockReportPage();
            break;
        case 'page-cash-book':
            initCashBookPage();
            $('cb-account').value = $('rf-cash-account').value;
            $('cb-date-from').value = $('rf-date-from').value;
            $('cb-date-to').value = $('rf-date-to').value;
            renderCashBookReport();
            break;
        case 'page-sale-report':
            $('Sale-report-date-from').value = $('rf-date-from').value;
            $('Sale-report-date-to').value = $('rf-date-to').value;
            renderInvoiceReport('Sale');
            break;
        case 'page-purchase-report':
            $('Purchase-report-date-from').value = $('rf-date-from').value;
            $('Purchase-report-date-to').value = $('rf-date-to').value;
            renderInvoiceReport('Purchase');
            break;
        case 'page-trial-balance':
            $('tb-as-of').value = $('rf-as-of').value;
            renderTrialBalance();
            break;
        case 'page-balance-sheet':
            $('bs-as-of').value = $('rf-as-of').value;
            renderBalanceSheet();
            break;
        case 'page-profit-on-sale':
            $('pos-date-from').value = $('rf-date-from').value;
            $('pos-date-to').value = $('rf-date-to').value;
            renderProfitOnSale();
            break;
        case 'page-profit-loss':
            $('pl-date-from').value = $('rf-date-from').value;
            $('pl-date-to').value = $('rf-date-to').value;
            renderProfitAndLoss();
            break;
    }

    closeReportFilterModal();
}
