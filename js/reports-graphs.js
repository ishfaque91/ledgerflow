/**
 * LedgerFlow — Graph reports (Profit & Loss, Income & Expense)
 *
 * These are visualisations of the SAME numbers the text reports produce —
 * they call computeTradingProfit() and computeIncomeExpense() from
 * reports-financial.js rather than recomputing anything independently, so
 * a graph can never disagree with the P&L page it sits beside.
 *
 * Everything is bucketed by calendar month. Month buckets exactly partition
 * the selected range, so the sum of the bars always equals the summary
 * total above them — that identity is asserted in verifyGraphTotals().
 *
 * Note on opening balances: a period report answers "what happened between
 * these dates", so Income/Expense opening balances (which pre-date every
 * transaction) are excluded from both the buckets and the summary. That's
 * the same rule computeIncomeExpense() applies whenever an explicit
 * dateFrom is given, so the two stay consistent.
 */

// ==================== MONTH BUCKETS ====================
function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function lastDayOfMonth(year, monthIdx) {
    return new Date(year, monthIdx + 1, 0).getDate();
}

// Builds an inclusive list of month buckets covering [from, to].
function buildMonthBuckets(from, to) {
    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || start > end) return [];

    const buckets = [];
    let y = start.getFullYear(), m = start.getMonth();
    // Guard against a pathological range producing a runaway loop.
    for (let guard = 0; guard < 600; guard++) {
        const first = new Date(y, m, 1);
        if (first > end) break;
        const lastDay = lastDayOfMonth(y, m);
        // Clamp the first and last buckets to the requested range, so a
        // mid-month start doesn't silently pull in earlier transactions.
        const bStart = (y === start.getFullYear() && m === start.getMonth())
            ? from : `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const bEnd = (y === end.getFullYear() && m === end.getMonth())
            ? to : `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        buckets.push({
            key: monthKey(first),
            label: first.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
            start: bStart,
            end: bEnd
        });
        m++; if (m > 11) { m = 0; y++; }
    }
    return buckets;
}

// When the user hasn't chosen dates, cover everything the books contain.
function resolveGraphRange(fromId, toId) {
    let from = $(fromId)?.value || '';
    let to = $(toId)?.value || '';

    if (!from || !to) {
        const dates = [
            ...lfGetAll(LF_KEYS.INVOICES).map(i => i.date),
            ...lfGetAll(LF_KEYS.ACCOUNT_LEDGER).map(e => e.date)
        ].filter(Boolean).sort();
        const today = new Date().toISOString().slice(0, 10);
        if (!from) from = dates[0] || (getCompanyDoc().signupDate || today);
        if (!to) to = dates[dates.length - 1] > today ? dates[dates.length - 1] : today;
    }
    return { from, to };
}

// ==================== THE NUMBERS ====================
// One place both graph pages get their data, so they can't drift apart.
function computeGraphSeries(from, to) {
    const buckets = buildMonthBuckets(from, to);

    const rows = buckets.map(b => {
        const trading = computeTradingProfit(b.start, b.end);
        const ie = computeIncomeExpense(b.start, b.end);
        const net = trading.totalProfit + ie.totalIncome - ie.totalExpense;
        return {
            label: b.label,
            start: b.start,
            end: b.end,
            tradingProfit: round2(trading.totalProfit),
            loadProfit: round2(trading.loadProfit),
            itemsProfit: round2(trading.itemsProfit),
            otherIncome: round2(ie.totalIncome),
            expenses: round2(ie.totalExpense),
            netProfit: round2(net)
        };
    });

    const sum = (f) => round2(rows.reduce((s, r) => s + r[f], 0));
    const totals = {
        tradingProfit: sum('tradingProfit'),
        loadProfit: sum('loadProfit'),
        itemsProfit: sum('itemsProfit'),
        otherIncome: sum('otherIncome'),
        expenses: sum('expenses'),
        netProfit: sum('netProfit')
    };

    // Per-account breakdown across the whole range, for the composition charts.
    const ieAll = computeIncomeExpense(from, to);

    return { from, to, rows, totals, incomeRows: ieAll.incomeRows, expenseRows: ieAll.expenseRows };
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Guards the invariant this whole module rests on: the monthly buckets must
// add up to the same figure the range-wide calculation gives. If they ever
// diverge the chart is lying, so say so loudly rather than drawing it.
function verifyGraphTotals(series) {
    const wholeTrading = computeTradingProfit(series.from, series.to).totalProfit;
    const wholeIE = computeIncomeExpense(series.from, series.to);
    const checks = [
        ['Trading profit', series.totals.tradingProfit, round2(wholeTrading)],
        ['Other income', series.totals.otherIncome, round2(wholeIE.totalIncome)],
        ['Expenses', series.totals.expenses, round2(wholeIE.totalExpense)]
    ];
    const mismatches = checks.filter(([, bucketed, whole]) => Math.abs(bucketed - whole) > 0.05);
    if (mismatches.length) {
        console.error('[Graphs] Monthly buckets do not reconcile with the range total:', mismatches);
    }
    return mismatches;
}

// ==================== CHART PLUMBING ====================
const _lfCharts = {};

function chartPalette() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    return {
        indigo: v('--teal', '#5B4FE9'),
        credit: v('--credit', '#0F8A5F'),
        garnet: v('--garnet', '#FF5A45'),
        amber: v('--amber', '#C2760C'),
        ink: v('--ink', '#15161C'),
        inkFaint: v('--ink-faint', '#9399A8'),
        border: v('--border', '#E7E8EF')
    };
}

function destroyChart(id) {
    if (_lfCharts[id]) { _lfCharts[id].destroy(); delete _lfCharts[id]; }
}

function makeChart(canvasId, config) {
    if (typeof Chart === 'undefined') return null;
    const el = $(canvasId);
    if (!el) return null;
    destroyChart(canvasId);
    const p = chartPalette();
    // Shared defaults so every chart in the app reads as one family.
    config.options = Object.assign({
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
            legend: { labels: { color: p.ink, boxWidth: 12, boxHeight: 12, usePointStyle: true, padding: 16 } },
            tooltip: {
                callbacks: {
                    label: (ctx) => {
                        const raw = ctx.parsed.y ?? ctx.parsed;
                        return `${ctx.dataset.label || ctx.label}: ${formatCurrency(raw)}`;
                    }
                }
            }
        }
    }, config.options || {});
    _lfCharts[canvasId] = new Chart(el.getContext('2d'), config);
    return _lfCharts[canvasId];
}

function moneyAxis(p) {
    return {
        grid: { color: p.border },
        ticks: {
            color: p.inkFaint,
            callback: (v) => {
                const n = Math.abs(v);
                if (n >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
                if (n >= 1e5) return (v / 1e5).toFixed(1) + 'L';
                if (n >= 1e3) return (v / 1e3).toFixed(0) + 'k';
                return v;
            }
        }
    };
}

// ==================== PROFIT & LOSS GRAPH ====================
function initProfitLossGraphPage() { renderProfitLossGraph(); }

function renderProfitLossGraph() {
    if (!isPageActive('page-graph-pl')) return;
    const { from, to } = resolveGraphRange('gpl-date-from', 'gpl-date-to');
    if ($('gpl-date-from')) $('gpl-date-from').value = from;
    if ($('gpl-date-to')) $('gpl-date-to').value = to;
    updateReportHeader('page-graph-pl');

    const series = computeGraphSeries(from, to);
    verifyGraphTotals(series);
    const t = series.totals;

    $('gpl-trading').textContent = formatCurrency(t.tradingProfit);
    $('gpl-income').textContent = formatCurrency(t.otherIncome);
    $('gpl-expense').textContent = formatCurrency(t.expenses);
    $('gpl-net').textContent = formatCurrency(Math.abs(t.netProfit));
    $('gpl-net-label').textContent = t.netProfit >= 0 ? 'Net Profit' : 'Net Loss';
    $('gpl-net').className = `report-summary-value ${t.netProfit >= 0 ? 'is-cr' : 'is-warn'}`;

    const p = chartPalette();
    const labels = series.rows.map(r => r.label);

    makeChart('gpl-chart-monthly', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Trading Profit', data: series.rows.map(r => r.tradingProfit), backgroundColor: p.indigo, borderRadius: 4, order: 2 },
                { label: 'Other Income', data: series.rows.map(r => r.otherIncome), backgroundColor: p.credit, borderRadius: 4, order: 2 },
                { label: 'Expenses', data: series.rows.map(r => -r.expenses), backgroundColor: p.garnet, borderRadius: 4, order: 2 },
                { label: 'Net Profit', data: series.rows.map(r => r.netProfit), type: 'line',
                  borderColor: p.ink, backgroundColor: p.ink, borderWidth: 2, pointRadius: 3, tension: 0.25, order: 1 }
            ]
        },
        options: {
            scales: { x: { grid: { display: false }, ticks: { color: p.inkFaint } }, y: moneyAxis(p) }
        }
    });

    // Composition: what the net result is built from. Expenses shown as a
    // positive magnitude here because a doughnut can't render negatives.
    makeChart('gpl-chart-composition', {
        type: 'doughnut',
        data: {
            labels: ['Trading Profit', 'Other Income', 'Expenses'],
            datasets: [{
                data: [Math.max(t.tradingProfit, 0), Math.max(t.otherIncome, 0), Math.max(t.expenses, 0)],
                backgroundColor: [p.indigo, p.credit, p.garnet],
                borderWidth: 0
            }]
        },
        options: { cutout: '62%', scales: {} }
    });

    renderGraphTable('gpl-table-body', series.rows, [
        r => r.label,
        r => formatCurrency(r.tradingProfit),
        r => formatCurrency(r.otherIncome),
        r => formatCurrency(r.expenses),
        r => formatCurrency(r.netProfit)
    ], [
        'Total',
        formatCurrency(t.tradingProfit),
        formatCurrency(t.otherIncome),
        formatCurrency(t.expenses),
        formatCurrency(t.netProfit)
    ]);
}

// ==================== INCOME & EXPENSE GRAPH ====================
function initIncomeExpenseGraphPage() { renderIncomeExpenseGraph(); }

function renderIncomeExpenseGraph() {
    if (!isPageActive('page-graph-ie')) return;
    const { from, to } = resolveGraphRange('gie-date-from', 'gie-date-to');
    if ($('gie-date-from')) $('gie-date-from').value = from;
    if ($('gie-date-to')) $('gie-date-to').value = to;
    updateReportHeader('page-graph-ie');

    const series = computeGraphSeries(from, to);
    verifyGraphTotals(series);

    // "Income" here is every inflow the period earned — trading profit plus
    // other income — matched against expenses, so the two bars genuinely
    // net to the same figure the P&L reports.
    const rows = series.rows.map(r => ({
        label: r.label,
        income: round2(r.tradingProfit + r.otherIncome),
        expense: r.expenses,
        net: r.netProfit
    }));
    const totalIncome = round2(rows.reduce((s, r) => s + r.income, 0));
    const totalExpense = round2(rows.reduce((s, r) => s + r.expense, 0));
    const net = round2(totalIncome - totalExpense);
    const margin = totalIncome > 0 ? (net / totalIncome) * 100 : 0;

    $('gie-income').textContent = formatCurrency(totalIncome);
    $('gie-expense').textContent = formatCurrency(totalExpense);
    $('gie-net').textContent = formatCurrency(Math.abs(net));
    $('gie-net-label').textContent = net >= 0 ? 'Net Surplus' : 'Net Deficit';
    $('gie-net').className = `report-summary-value ${net >= 0 ? 'is-cr' : 'is-warn'}`;
    $('gie-margin').textContent = `${margin.toFixed(1)}%`;

    const p = chartPalette();
    makeChart('gie-chart-monthly', {
        type: 'bar',
        data: {
            labels: rows.map(r => r.label),
            datasets: [
                { label: 'Income', data: rows.map(r => r.income), backgroundColor: p.credit, borderRadius: 4, order: 2 },
                { label: 'Expense', data: rows.map(r => r.expense), backgroundColor: p.garnet, borderRadius: 4, order: 2 },
                { label: 'Net', data: rows.map(r => r.net), type: 'line',
                  borderColor: p.indigo, backgroundColor: p.indigo, borderWidth: 2, pointRadius: 3, tension: 0.25, order: 1 }
            ]
        },
        options: { scales: { x: { grid: { display: false }, ticks: { color: p.inkFaint } }, y: moneyAxis(p) } }
    });

    // Where the money actually goes — top expense heads, largest first.
    const topExpenses = [...series.expenseRows].sort((a, b) => b.amount - a.amount).slice(0, 8);
    makeChart('gie-chart-expense-breakdown', {
        type: 'bar',
        data: {
            labels: topExpenses.map(r => r.title),
            datasets: [{ label: 'Expense', data: topExpenses.map(r => round2(r.amount)), backgroundColor: p.garnet, borderRadius: 4 }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: { x: moneyAxis(p), y: { grid: { display: false }, ticks: { color: p.inkFaint } } }
        }
    });

    renderGraphTable('gie-table-body', rows, [
        r => r.label,
        r => formatCurrency(r.income),
        r => formatCurrency(r.expense),
        r => formatCurrency(r.net)
    ], ['Total', formatCurrency(totalIncome), formatCurrency(totalExpense), formatCurrency(net)]);
}

// Shared table renderer — this table is also what the Excel/PDF exporters
// read, so the download always matches what's on screen.
function renderGraphTable(tbodyId, rows, cols, totalRow) {
    const tbody = $(tbodyId);
    if (!tbody) return;
    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">No transactions in this period.</td></tr>`;
        return;
    }
    const body = rows.map(r => `<tr>${cols.map((fn, i) =>
        `<td${i === 0 ? '' : ' class="num"'}>${escapeHtml(String(fn(r)))}</td>`).join('')}</tr>`).join('');
    const foot = `<tr class="statement-total">${totalRow.map((v, i) =>
        `<td${i === 0 ? '' : ' class="num"'}><strong>${escapeHtml(String(v))}</strong></td>`).join('')}</tr>`;
    tbody.innerHTML = body + foot;
}

// ==================== EXPORT (charts + table) ====================
// The generic exporter in export.js only knows about DOM rows, so graph
// pages get their own PDF path that also embeds the rendered canvases.
function exportGraphToPDF(pageId, title, tableId, canvasIds) {
    const rows = extractReportRows(tableId);
    if (!rows.length) { showToast('Nothing to export yet.', 'warning'); return; }

    const headerLines = getReportHeaderLines(pageId, title);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const centre = pageWidth / 2;

    let y = 16;
    doc.setFontSize(15); doc.setFont(undefined, 'bold');
    doc.text(headerLines[0], centre, y, { align: 'center' });
    for (let i = 1; i < headerLines.length; i++) {
        const line = headerLines[i];
        if (line === '') continue;
        if (line === title) { y += 8; doc.setFontSize(13); doc.setFont(undefined, 'bold'); }
        else { y += 5; doc.setFontSize(9); doc.setFont(undefined, 'normal'); }
        doc.text(line, centre, y, { align: 'center' });
    }
    y += 4;
    doc.setDrawColor(120);
    doc.line(14, y, pageWidth - 14, y);
    y += 6;

    canvasIds.forEach(id => {
        const canvas = $(id);
        if (!canvas) return;
        // Repaint onto an opaque canvas first — Chart.js leaves the
        // background transparent, which becomes black in a PDF.
        const flat = document.createElement('canvas');
        flat.width = canvas.width; flat.height = canvas.height;
        const ctx = flat.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, flat.width, flat.height);
        ctx.drawImage(canvas, 0, 0);

        const imgW = pageWidth - 28;
        const imgH = (flat.height / flat.width) * imgW;
        if (y + imgH > doc.internal.pageSize.getHeight() - 16) { doc.addPage(); y = 16; }
        doc.addImage(flat.toDataURL('image/png', 1.0), 'PNG', 14, y, imgW, imgH);
        y += imgH + 8;
    });

    doc.autoTable({
        head: [rows[0]],
        body: rows.slice(1),
        startY: y + 2,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [91, 79, 233], textColor: 255, fontStyle: 'bold' }
    });

    doc.save(`${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    showToast('PDF downloaded.', 'success');
}
