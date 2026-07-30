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
