/**
 * LedgerFlow - App shell: navigation, sidebar behaviour.
 * Data rendering is now driven by auth.js, once a real company is
 * resolved after login — there's no data to show before that.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Open the Management group by default since that's what we're building first
    document.querySelectorAll('.nav-group').forEach(group => {
        if (group.classList.contains('is-active')) group.classList.add('is-open');
    });
});

// ==================== NAVIGATION ====================
function navigateTo(pageId, linkEl) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));
    const target = $(pageId);
    if (target) target.classList.add('is-active');

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('is-active'));
    if (linkEl) linkEl.classList.add('is-active');

    if (pageId === 'page-dashboard') renderDashboard();

    if (window.innerWidth <= 900) toggleSidebar(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDashboard() {
    $('dash-accounts-count').textContent = lfGetAll(LF_KEYS.ACCOUNTS).length;
    $('dash-items-count').textContent = lfGetAll(LF_KEYS.ITEMS).length;
    $('dash-users-count').textContent = lfGetAll(LF_KEYS.USERS).length;

    const loadBalance = lfGetAll(LF_KEYS.LOAD_LEDGER).reduce((sum, e) => sum + e.qtyChange, 0);
    $('dash-load-balance').textContent = loadBalance.toLocaleString('en-US');

    ['Purchase', 'PurchaseReturn', 'Sale', 'SaleReturn'].forEach(type => {
        const el = $(`dash-count-${type}`);
        if (el) el.textContent = lfGetAll(LF_KEYS.INVOICES).filter(i => i.type === type).length;
    });
}

function toggleGroup(headerBtn) {
    const group = headerBtn.closest('.nav-group');
    if (!group) return;
    group.classList.toggle('is-open');
}

function toggleSidebar(force) {
    const sidebar = $('sidebar');
    const overlay = $('sidebar-overlay');
    const shouldOpen = typeof force === 'boolean' ? force : !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', shouldOpen);
    overlay.classList.toggle('is-open', shouldOpen);
}
