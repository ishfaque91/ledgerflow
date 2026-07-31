/**
 * LedgerFlow - App shell: navigation, sidebar behaviour.
 * Data rendering is now driven by auth.js, once a real company is
 * resolved after login — there's no data to show before that.
 */

// Every nav-link and directory tile is written as <a href="#" onclick="...">.
// Without this, clicking one ALSO triggers the browser's own default
// "navigate to '#'" behavior alongside our onclick handler — which,
// combined with the history.pushState() calls below, was fighting our own
// navigation and randomly snapping back to Dashboard. This one delegated
// listener stops that, for every such link across the whole app.
document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a[href="#"]');
    if (anchor) e.preventDefault();
});

// ==================== NAVIGATION ====================
let isHandlingPopstate = false;

function navigateTo(pageId, linkEl) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));
    const target = $(pageId);
    if (target) target.classList.add('is-active');

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('is-active'));

    // Always look up the real sidebar link for this page — regardless of
    // whether navigateTo() was triggered from the sidebar itself or from
    // somewhere else, like the Dashboard's directory of links.
    const sidebarLink = document.querySelector(`.sidebar .nav-link[data-page="${pageId}"]`);
    if (sidebarLink) sidebarLink.classList.add('is-active');

    // Collapse every other group, expand only the one this page belongs to.
    document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('is-open'));
    const parentGroup = sidebarLink?.closest('.nav-group');
    if (parentGroup) parentGroup.classList.add('is-open');

    if (pageId === 'page-dashboard') renderDashboard();

    // Record this in the browser's own history, so the phone/browser back
    // button moves between LedgerFlow's own pages instead of leaving the
    // site entirely. Skip this when we're the ones RESPONDING to a
    // back/forward press — otherwise we'd re-push and get stuck.
    if (!isHandlingPopstate) {
        if (pageId === 'page-dashboard') {
            history.replaceState({ page: pageId }, '', '#' + pageId);
        } else {
            history.pushState({ page: pageId }, '', '#' + pageId);
        }
    }
    isHandlingPopstate = false;

    if (window.innerWidth <= 900) toggleSidebar(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('popstate', (event) => {
    // Only handle this once the app is actually showing (ignore stray
    // popstate events that can fire before login resolves).
    if ($('app-root').classList.contains('hidden')) return;

    if (event.state && event.state.page) {
        isHandlingPopstate = true;
        navigateTo(event.state.page);
        if (event.state.page === 'page-dashboard') {
            // We've hit the Dashboard boundary — re-establish it as the
            // current history entry so pressing back again refreshes
            // Dashboard instead of exiting the site.
            history.replaceState({ page: 'page-dashboard' }, '', '#page-dashboard');
            renderDashboard();
        }
    } else {
        // No app page in this history entry at all — we've gone back past
        // everything LedgerFlow ever pushed. Refresh Dashboard rather than
        // letting the browser leave the site.
        history.replaceState({ page: 'page-dashboard' }, '', '#page-dashboard');
        navigateTo('page-dashboard');
    }
});

// Dashboard is now just the "Everywhere in LedgerFlow" shortcut grid (no
// live stats), so there's nothing left to compute — kept as a no-op since
// navigateTo() and the login/history flows still call it.
function renderDashboard() {}

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
