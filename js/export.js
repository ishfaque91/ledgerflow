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
            // Statement-style reports (Balance Sheet, P&L, Profit on Sale) are
            // divs, not tables. Previously only .statement-row was picked up,
            // so every section label ("Assets", "Liabilities", "Equity") was
            // dropped and the export came out as one unlabelled list of
            // numbers. Walk the section in document order instead, keeping the
            // headings so the exported file mirrors the on-screen layout.
            // The container is sometimes the section itself (Profit on Sale,
            // P&L) and sometimes a grid wrapping several (Balance Sheet), so
            // handle both rather than only looking at descendants.
            const sections = container.matches('.statement-section, .card')
                ? [container]
                : [...container.querySelectorAll('.statement-section, .card')];

            sections.forEach(section => {
                section.querySelectorAll('h3, .statement-subtitle, .statement-row, .dash-invoice-row, .totals-row')
                    .forEach(el => {
                        if (el.matches('h3, .statement-subtitle')) {
                            const label = el.innerText.trim();
                            if (label) rows.push([label, '']);
                        } else {
                            const cells = [...el.children].map(c => c.innerText.trim());
                            if (cells.length) rows.push(cells);
                        }
                    });
            });
            // Fall back to the old flat scan if the markup has no sections.
            if (!rows.length) {
                container.querySelectorAll('.statement-row, .dash-invoice-row').forEach(rowEl => {
                    const cells = [...rowEl.children].map(el => el.innerText.trim());
                    if (cells.length) rows.push(cells);
                });
            }
        }
    });

    return rows;
}

// Reports that are "about" one selected thing — the export and the on-screen
// heading both need to say which one, otherwise an Account Ledger PDF is
// indistinguishable from any other account's.
const REPORT_SUBJECT_FIELDS = {
    'page-account-ledger': { selectId: 'al-account', label: 'Account' },
    'page-cash-book': { selectId: 'cb-account', label: 'Account' },
    'page-item-ledger': { selectId: 'il-item', label: 'Item' }
};

function getReportSubjectName(pageId) {
    const cfg = REPORT_SUBJECT_FIELDS[pageId];
    if (!cfg) return '';
    const select = $(cfg.selectId);
    if (!select || !select.value) return '';
    const text = select.options[select.selectedIndex]?.text || '';
    return text.trim();
}

// Which date-filter fields belong to each report, so exports can show
// exactly what range was actually used to generate what's on screen.
const REPORT_DATE_FIELDS = {
    'page-account-ledger': { from: 'al-date-from', to: 'al-date-to' },
    'page-load-ledger': { from: 'll-date-from', to: 'll-date-to' },
    'page-item-ledger': { from: 'il-date-from', to: 'il-date-to' },
    'page-cash-book': { from: 'cb-date-from', to: 'cb-date-to' },
    'page-sale-report': { from: 'Sale-report-date-from', to: 'Sale-report-date-to' },
    'page-purchase-report': { from: 'Purchase-report-date-from', to: 'Purchase-report-date-to' },
    'page-trial-balance': { asOf: 'tb-as-of' },
    'page-balance-sheet': { asOf: 'bs-as-of' },
    'page-profit-on-sale': { from: 'pos-date-from', to: 'pos-date-to' },
    'page-profit-loss': { from: 'pl-date-from', to: 'pl-date-to' },
    'page-graph-pl': { from: 'gpl-date-from', to: 'gpl-date-to' },
    'page-graph-ie': { from: 'gie-date-from', to: 'gie-date-to' }
};

function formatDateNice(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Builds the letterhead lines shown at the top of every export: company
// name, address, phone, which report this is, and the exact date range
// (or "as of" date) that was actually used to generate it.
function getReportDateLine(pageId) {
    const dateConfig = REPORT_DATE_FIELDS[pageId];
    if (!dateConfig) return '';
    if (dateConfig.asOf) {
        const asOf = $(dateConfig.asOf)?.value;
        return asOf ? `As of ${formatDateNice(asOf)}` : '';
    }
    const from = $(dateConfig.from)?.value;
    const to = $(dateConfig.to)?.value;
    if (!from && !to) return '';
    return `${from ? 'From ' + formatDateNice(from) : 'From the beginning'} to ${to ? formatDateNice(to) : 'today'}`;
}

function getReportHeaderLines(pageId, title) {
    const settings = (typeof lfGetSettings === 'function') ? lfGetSettings() : {};
    const lines = [];

    lines.push(settings.companyName || 'Company');
    const addressParts = [settings.companyAddress, settings.companyCity].filter(Boolean);
    if (addressParts.length) lines.push(addressParts.join(', '));
    if (settings.companyPhone) lines.push(`Phone: +92 ${settings.companyPhone}`);

    lines.push(''); // spacer
    lines.push(title);

    const subject = getReportSubjectName(pageId);
    if (subject) lines.push(`${REPORT_SUBJECT_FIELDS[pageId].label}: ${subject}`);

    const dateLine = getReportDateLine(pageId);
    if (dateLine) lines.push(dateLine);

    lines.push(`Generated ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    return lines;
}

// ==================== ON-SCREEN / PRINT REPORT HEADER ====================
// Builds the same letterhead the PDF and Excel exports use, directly into
// the report page itself — so what's on screen, what prints, and what
// downloads all carry identical company details, report name, subject and
// date range. Injected once per page, then updated on every render.
function renderReportDocHeader(pageId, title) {
    const section = document.getElementById(pageId);
    if (!section) return;

    let header = section.querySelector('.report-doc-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'report-doc-header';
        const pageHead = section.querySelector('.page-head');
        if (pageHead) pageHead.insertAdjacentElement('afterend', header);
        else section.prepend(header);
    }

    const settings = (typeof lfGetSettings === 'function') ? lfGetSettings() : {};
    const addressParts = [settings.companyAddress, settings.companyCity].filter(Boolean);
    const subject = getReportSubjectName(pageId);
    const dateLine = getReportDateLine(pageId);

    header.innerHTML = `
        <div class="rdh-company">${escapeHtml(settings.companyName || 'Company')}</div>
        ${addressParts.length ? `<div class="rdh-meta">${escapeHtml(addressParts.join(', '))}</div>` : ''}
        ${settings.companyPhone ? `<div class="rdh-meta">Phone: +92 ${escapeHtml(settings.companyPhone)}</div>` : ''}
        <div class="rdh-title">${escapeHtml(title)}</div>
        ${subject ? `<div class="rdh-subject">${escapeHtml(REPORT_SUBJECT_FIELDS[pageId].label)}: ${escapeHtml(subject)}</div>` : ''}
        ${dateLine ? `<div class="rdh-meta">${escapeHtml(dateLine)}</div>` : ''}
    `;
}

function exportReportToPDF(containerIds, title, pageId) {
    const rows = extractReportRows(containerIds);
    if (!rows.length) { showToast('Nothing to export yet.', 'warning'); return; }

    const headerLines = getReportHeaderLines(pageId, title);
    const { jsPDF } = window.jspdf;
    // Always portrait now — a wide report (Account Ledger, Cash Book, the
    // invoice registers) shrinks its font instead of the page flipping to
    // landscape, since a mix of portrait and landscape pages across your
    // reports is exactly the "not portrait friendly" problem this fixes.
    const wide = rows[0].length > 5;
    const doc = new jsPDF({ orientation: 'portrait' });

    // Centre the letterhead over the printable width, and give the report
    // title (and the account/item a report is about) real visual weight so a
    // printed Account Ledger is identifiable at a glance.
    const pageWidth = doc.internal.pageSize.getWidth();
    const centre = pageWidth / 2;
    const subject = getReportSubjectName(pageId);
    const subjectLine = subject ? `${REPORT_SUBJECT_FIELDS[pageId].label}: ${subject}` : null;

    let y = 16;
    doc.setFontSize(15);
    doc.setFont(undefined, 'bold');
    doc.text(headerLines[0], centre, y, { align: 'center' });

    for (let i = 1; i < headerLines.length; i++) {
        const line = headerLines[i];
        if (line === '') continue;

        if (line === title) {
            y += 8;
            doc.setFontSize(13);
            doc.setFont(undefined, 'bold');
        } else if (subjectLine && line === subjectLine) {
            y += 6;
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
        } else {
            y += 5;
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
        }
        doc.text(line, centre, y, { align: 'center' });
    }

    y += 4;
    doc.setDrawColor(120);
    doc.line(14, y, pageWidth - 14, y);

    // Statement-style reports export as [label, value] pairs; giving them a
    // real header row and column widths is what makes a Balance Sheet PDF
    // readable instead of an unlabelled two-column blob.
    const isStatement = rows.length > 0 && rows[0].length === 2;
    doc.autoTable({
        head: isStatement ? [['Description', 'Amount']] : undefined,
        body: rows,
        startY: y + 5,
        // A portrait page is ~180mm usable width. A 7-column table (Account
        // Ledger, Cash Book) at the normal 8pt/3pt padding used to only fit
        // in landscape — shrink both a step further for anything wider
        // than 5 columns so it still fits on a portrait sheet without
        // truncating or overlapping.
        styles: { fontSize: wide ? 6.5 : 8, cellPadding: wide ? 1.6 : 3, overflow: 'linebreak' },
        headStyles: { fillColor: [91, 79, 233], textColor: 255, fontStyle: 'bold', fontSize: wide ? 7 : 8 },
        columnStyles: isStatement ? { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 45 } } : {},
        tableWidth: 'auto',
        // Section labels come through as [label, ''] — render those as bold
        // sub-headers with a tint so the structure survives the export.
        didParseCell: (data) => {
            if (data.section === 'body' && data.row.raw[1] === '' && data.row.raw[0]) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = [237, 235, 252];
            }
        }
    });

    doc.save(`${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    showToast('PDF downloaded.', 'success');
}

function exportReportToExcel(containerIds, title, pageId) {
    const rows = extractReportRows(containerIds);
    if (!rows.length) { showToast('Nothing to export yet.', 'warning'); return; }

    const headerLines = getReportHeaderLines(pageId, title).filter(l => l !== '');
    const sheetRows = headerLines.map(l => [l]).concat([[]], rows);

    const ws = XLSX.utils.aoa_to_sheet(sheetRows);

    // Without explicit widths every column renders at Excel's default ~8
    // characters, so account titles and the letterhead were cut off. Size
    // each column to its widest actual value (capped so one long narration
    // can't blow the sheet out).
    const colCount = sheetRows.reduce((max, r) => Math.max(max, r.length), 0);
    ws['!cols'] = Array.from({ length: colCount }, (_, c) => {
        const widest = sheetRows.reduce((max, r) => {
            const cell = r[c];
            return cell == null ? max : Math.max(max, String(cell).length);
        }, 10);
        return { wch: Math.min(widest + 2, 45) };
    });

    // Merge the letterhead lines across the table so they read as a title
    // block rather than being trapped in column A.
    if (colCount > 1) {
        ws['!merges'] = headerLines.map((_, i) => ({
            s: { r: i, c: 0 }, e: { r: i, c: colCount - 1 }
        }));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${title.replace(/[^a-z0-9]+/gi, '_')}.xlsx`);
    showToast('Excel file downloaded.', 'success');
}

// Called by each report's render function so the letterhead always matches
// the data currently on screen (title comes from REPORT_FILTER_CONFIG below,
// the single place every report's display name is already defined).
function updateReportHeader(pageId) {
    const cfg = REPORT_FILTER_CONFIG[pageId];
    if (cfg) renderReportDocHeader(pageId, cfg.title);
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
    'page-account-ledger': { title: 'Account Ledger', fields: ['account', 'dateRange'] },
    'page-load-ledger': { title: 'Load Ledger', fields: ['dateRange'] },
    'page-item-ledger': { title: 'Item Ledger', fields: ['item', 'dateRange'] },
    'page-stock-report': { title: 'Stock Report', fields: ['dateRange'] },
    'page-cash-book': { title: 'Cash Book', fields: ['cashAccount', 'dateRange'] },
    'page-sale-report': { title: 'Sale Invoices Report', fields: ['dateRange'] },
    'page-purchase-report': { title: 'Purchase Invoices Report', fields: ['dateRange'] },
    'page-trial-balance': { title: 'Trial Balance', fields: ['asOf'] },
    'page-balance-sheet': { title: 'Balance Sheet', fields: ['asOf'] },
    'page-profit-on-sale': { title: 'Profit on Sale', fields: ['dateRange'] },
    'page-profit-loss': { title: 'Profit & Loss', fields: ['dateRange'] },
    'page-graph-pl': { title: 'Profit & Loss Graph', fields: ['dateRange'] },
    'page-graph-ie': { title: 'Income & Expense Graph', fields: ['dateRange'] }
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
        const companyStart = getCompanyDoc().signupDate || '';
        $('rf-date-from').value = companyStart;
        $('rf-date-to').value = new Date().toISOString().slice(0, 10);
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

    // Wrapped in try/finally: if a report's render function throws, the
    // filter modal used to stay stuck open (and the report silently blank),
    // which is exactly how the missing Balance Sheet Assets column hid
    // itself. Now the modal always closes and the error surfaces properly.
    try {
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
            $('stock-date-from').value = $('rf-date-from').value;
            $('stock-date-to').value = $('rf-date-to').value;
            renderStockReport();
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
    } catch (err) {
        console.error('[Reports] Failed to generate report:', err);
        showToast('Something went wrong generating that report.', 'error');
    } finally {
        closeReportFilterModal();
    }
}
