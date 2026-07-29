/**
 * LedgerFlow - Reports module, Phase 2 (the financial statements).
 *
 * These are built entirely on top of Phase 1's data: account balances,
 * and the Sale/Purchase invoice totals. Nothing here writes any data.
 *
 * Trading Profit = Net Sales − Net Purchases (Load and Items each,
 * per the simple costing method — no per-unit FIFO/average costing).
 * Retained Earnings on the Balance Sheet = all-time Net Profit up to
 * the chosen date, so Assets = Liabilities + Equity keeps holding even
 * though Income/Expense accounts never sit directly on the Balance Sheet.
 */

const ASSET_TYPES = ['Asset', 'Cash', 'Bank', 'Customer', 'Employee/RSO', 'Branch'];
const LIABILITY_TYPES = ['Liability', 'Supplier'];

// ==================== ACCOUNT BALANCE AS OF A DATE ====================
function computeAccountBalanceAsOf(accountId, asOfDate) {
    const acc = lfFindById(LF_KEYS.ACCOUNTS, accountId);
    if (!acc) return { amount: 0, side: 'Dr' };

    let net = (acc.openingSide === 'Cr' ? -1 : 1) * (acc.openingAmount || 0);
    lfGetAll(LF_KEYS.ACCOUNT_LEDGER)
        .filter(e => e.accountId === accountId && (!asOfDate || e.date <= asOfDate))
        .forEach(e => { net += (e.side === 'Cr' ? -1 : 1) * e.amount; });

    return { amount: Math.abs(net), side: net >= 0 ? 'Dr' : 'Cr' };
}

// ==================== TRADING PROFIT (Load + Items, from Sale/Purchase invoices) ====================
function computeTradingProfit(dateFrom, dateTo) {
    const invoices = lfGetAll(LF_KEYS.INVOICES).filter(i =>
        (!dateFrom || i.date >= dateFrom) && (!dateTo || i.date <= dateTo)
    );

    const sumBy = (type, field) => invoices.filter(i => i.type === type).reduce((s, i) => s + (i[field] || 0), 0);

    const loadSales = sumBy('Sale', 'loadTotal') - sumBy('SaleReturn', 'loadTotal');
    const loadPurchases = sumBy('Purchase', 'loadTotal') - sumBy('PurchaseReturn', 'loadTotal');
    const itemsSales = sumBy('Sale', 'itemsTotal') - sumBy('SaleReturn', 'itemsTotal');
    const itemsPurchases = sumBy('Purchase', 'itemsTotal') - sumBy('PurchaseReturn', 'itemsTotal');

    const loadProfit = loadSales - loadPurchases;
    const itemsProfit = itemsSales - itemsPurchases;

    return {
        loadSales, loadPurchases, loadProfit,
        itemsSales, itemsPurchases, itemsProfit,
        totalProfit: loadProfit + itemsProfit
    };
}

// ==================== OTHER INCOME / OPERATING EXPENSES (from Income/Expense accounts) ====================
function computeIncomeExpense(dateFrom, dateTo) {
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS);
    const entries = lfGetAll(LF_KEYS.ACCOUNT_LEDGER).filter(e =>
        (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo)
    );

    const incomeRows = [];
    const expenseRows = [];

    accounts.filter(a => a.type === 'Income').forEach(a => {
        const net = entries.filter(e => e.accountId === a.id)
            .reduce((s, e) => s + (e.side === 'Cr' ? e.amount : -e.amount), 0);
        if (net !== 0) incomeRows.push({ title: a.title, amount: net });
    });

    accounts.filter(a => a.type === 'Expense').forEach(a => {
        const net = entries.filter(e => e.accountId === a.id)
            .reduce((s, e) => s + (e.side === 'Dr' ? e.amount : -e.amount), 0);
        if (net !== 0) expenseRows.push({ title: a.title, amount: net });
    });

    return {
        incomeRows, expenseRows,
        totalIncome: incomeRows.reduce((s, r) => s + r.amount, 0),
        totalExpense: expenseRows.reduce((s, r) => s + r.amount, 0)
    };
}

function computeNetProfit(dateFrom, dateTo) {
    const trading = computeTradingProfit(dateFrom, dateTo);
    const incExp = computeIncomeExpense(dateFrom, dateTo);
    return trading.totalProfit + incExp.totalIncome - incExp.totalExpense;
}

// ==================== TRIAL BALANCE ====================
function initTrialBalancePage() {
    if (!$('tb-as-of').value) $('tb-as-of').value = new Date().toISOString().slice(0, 10);
    renderTrialBalance();
}

function renderTrialBalance() {
    const asOf = $('tb-as-of').value;
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS).sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));

    let totalDr = 0, totalCr = 0;
    const rows = accounts.map(a => {
        const bal = computeAccountBalanceAsOf(a.id, asOf);
        if (bal.side === 'Dr') totalDr += bal.amount; else totalCr += bal.amount;
        return { account: a, balance: bal };
    }).filter(r => r.balance.amount > 0.004);

    const tbody = $('tb-table-body');
    tbody.innerHTML = rows.length === 0
        ? `<tr class="empty-row"><td colspan="4">No account balances yet.</td></tr>`
        : rows.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.account.title)}</strong></td>
                <td><span class="type-badge">${escapeHtml(r.account.type)}</span></td>
                <td class="num">${r.balance.side === 'Dr' ? formatCurrency(r.balance.amount) : '-'}</td>
                <td class="num">${r.balance.side === 'Cr' ? formatCurrency(r.balance.amount) : '-'}</td>
            </tr>
        `).join('');

    const diff = Math.round((totalDr - totalCr) * 100) / 100;
    let footHtml = `
        <tr class="statement-total">
            <td colspan="2"><strong>Total</strong></td>
            <td class="num"><strong>${formatCurrency(totalDr)}</strong></td>
            <td class="num"><strong>${formatCurrency(totalCr)}</strong></td>
        </tr>`;
    if (diff !== 0) {
        footHtml += `
        <tr>
            <td colspan="2">Difference</td>
            <td class="num" colspan="2" style="color:var(--garnet); font-weight:700;">${formatCurrency(Math.abs(diff))} ${diff > 0 ? '(Debit heavy)' : '(Credit heavy)'}</td>
        </tr>`;
    }
    $('tb-table-foot').innerHTML = footHtml;
}

// ==================== BALANCE SHEET ====================
function initBalanceSheetPage() {
    if (!$('bs-as-of').value) $('bs-as-of').value = new Date().toISOString().slice(0, 10);
    renderBalanceSheet();
}

function statementRowHtml(title, amount) {
    return `<div class="statement-row"><span>${escapeHtml(title)}</span><span>${formatCurrency(amount)}</span></div>`;
}

function renderBalanceSheet() {
    const asOf = $('bs-as-of').value;
    const accounts = lfGetAll(LF_KEYS.ACCOUNTS);

    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
    const assetRows = [], liabilityRows = [], equityRows = [];

    accounts.forEach(acc => {
        const bal = computeAccountBalanceAsOf(acc.id, asOf);
        if (bal.amount <= 0.004) return;

        if (acc.type === 'Owner Equity') {
            const signed = bal.side === 'Cr' ? bal.amount : -bal.amount;
            totalEquity += signed;
            equityRows.push({ title: acc.title, amount: signed });
        } else if (ASSET_TYPES.includes(acc.type)) {
            const signed = bal.side === 'Dr' ? bal.amount : -bal.amount;
            totalAssets += signed;
            assetRows.push({ title: acc.title, amount: signed });
        } else if (LIABILITY_TYPES.includes(acc.type)) {
            const signed = bal.side === 'Cr' ? bal.amount : -bal.amount;
            totalLiabilities += signed;
            liabilityRows.push({ title: acc.title, amount: signed });
        } else if (acc.type === 'Customer/Supplier') {
            if (bal.side === 'Dr') { totalAssets += bal.amount; assetRows.push({ title: acc.title, amount: bal.amount }); }
            else { totalLiabilities += bal.amount; liabilityRows.push({ title: acc.title, amount: bal.amount }); }
        }
        // Income/Expense accounts don't sit directly on the Balance Sheet —
        // their net effect is folded into Retained Earnings below.
    });

    const netProfit = Math.round(computeNetProfit('', asOf) * 100) / 100;
    totalEquity += netProfit;
    equityRows.push({ title: 'Retained Earnings (Net Profit)', amount: netProfit });

    const totalLiabEquity = totalLiabilities + totalEquity;
    const difference = Math.round((totalAssets - totalLiabEquity) * 100) / 100;

    $('bs-total-assets').textContent = formatCurrency(totalAssets);
    $('bs-total-liab-equity').textContent = formatCurrency(totalLiabEquity);
    $('bs-difference').textContent = formatCurrency(Math.abs(difference));
    $('bs-difference').className = `report-summary-value ${difference === 0 ? '' : 'is-warn'}`;

    $('bs-assets-rows').innerHTML = assetRows.length
        ? assetRows.map(r => statementRowHtml(r.title, r.amount)).join('')
        : `<div class="statement-row"><span>No assets yet</span><span>-</span></div>`;
    $('bs-assets-total').textContent = formatCurrency(totalAssets);

    $('bs-liabilities-rows').innerHTML = liabilityRows.length
        ? liabilityRows.map(r => statementRowHtml(r.title, r.amount)).join('')
        : `<div class="statement-row"><span>None</span><span>-</span></div>`;

    $('bs-equity-rows').innerHTML = equityRows.map(r => statementRowHtml(r.title, r.amount)).join('');
    $('bs-liab-equity-total').textContent = formatCurrency(totalLiabEquity);
}

// ==================== PROFIT ON SALE ====================
function initProfitOnSalePage() { renderProfitOnSale(); }

function renderProfitOnSale() {
    const dateFrom = $('pos-date-from').value;
    const dateTo = $('pos-date-to').value;
    const t = computeTradingProfit(dateFrom, dateTo);

    $('pos-load-sales').textContent = formatCurrency(t.loadSales);
    $('pos-load-purchases').textContent = formatCurrency(t.loadPurchases);
    $('pos-load-profit').textContent = formatCurrency(t.loadProfit);

    $('pos-items-sales').textContent = formatCurrency(t.itemsSales);
    $('pos-items-purchases').textContent = formatCurrency(t.itemsPurchases);
    $('pos-items-profit').textContent = formatCurrency(t.itemsProfit);

    $('pos-total-profit').textContent = formatCurrency(t.totalProfit);
}

// ==================== PROFIT & LOSS ====================
function initProfitLossPage() { renderProfitAndLoss(); }

function renderProfitAndLoss() {
    const dateFrom = $('pl-date-from').value;
    const dateTo = $('pl-date-to').value;

    const trading = computeTradingProfit(dateFrom, dateTo);
    const incExp = computeIncomeExpense(dateFrom, dateTo);
    const netProfit = trading.totalProfit + incExp.totalIncome - incExp.totalExpense;

    $('pl-load-profit').textContent = formatCurrency(trading.loadProfit);
    $('pl-items-profit').textContent = formatCurrency(trading.itemsProfit);
    $('pl-trading-profit').textContent = formatCurrency(trading.totalProfit);

    $('pl-income-rows').innerHTML = incExp.incomeRows.length
        ? incExp.incomeRows.map(r => statementRowHtml(r.title, r.amount)).join('')
        : `<div class="statement-row"><span>None this period</span><span>-</span></div>`;
    $('pl-income-total').textContent = formatCurrency(incExp.totalIncome);

    $('pl-expense-rows').innerHTML = incExp.expenseRows.length
        ? incExp.expenseRows.map(r => statementRowHtml(r.title, r.amount)).join('')
        : `<div class="statement-row"><span>None this period</span><span>-</span></div>`;
    $('pl-expense-total').textContent = formatCurrency(incExp.totalExpense);

    $('pl-summary-trading').textContent = formatCurrency(trading.totalProfit);
    $('pl-summary-income').textContent = formatCurrency(incExp.totalIncome);
    $('pl-summary-expense').textContent = formatCurrency(incExp.totalExpense);
    $('pl-net-label').textContent = netProfit >= 0 ? 'Net Profit' : 'Net Loss';
    $('pl-net-profit').textContent = formatCurrency(Math.abs(netProfit));
}
