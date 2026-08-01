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

// ==================== PORTRAIT LOCK ====================
// screen.orientation.lock() only actually succeeds in a fullscreen or
// installed-PWA context (a plain browser tab always rejects it) -- but it
// costs nothing to try, and it's what makes an installed home-screen app
// genuinely stay portrait rather than just visually degrading via CSS
// when someone rotates. The .rotate-overlay in the CSS is the real
// fallback for everyone else.
function tryLockPortrait() {
    try {
        screen.orientation?.lock?.('portrait').catch(() => {});
    } catch (err) { /* not supported here — the CSS overlay covers it */ }
}
tryLockPortrait();
window.addEventListener('load', tryLockPortrait);
document.addEventListener('fullscreenchange', tryLockPortrait);

// ==================== NAVIGATION ====================
// Every real navigation PUSHES a history entry (Dashboard included), so the
// back/forward buttons move through LedgerFlow's own pages like a normal
// multi-page site. The one thing that needs guarding against is running out
// of entries: once Back goes past the very first page the app ever pushed,
// the browser would otherwise leave the app entirely (back to whatever tab
// or site was open before). The popstate handler below catches that exact
// moment — no state on the entry we landed on — and re-plants Dashboard as
// a fresh entry instead, so Back just keeps you on Dashboard rather than
// exiting. isHandlingPopstate exists so responding to a back/forward press
// never re-pushes and gets the two mechanisms fighting each other.
let isHandlingPopstate = false;

function navigateTo(pageId, linkEl) {
    // Enforce User Rights even if someone reaches a gated page a way other
    // than clicking its (already-hidden) sidebar link — typing a hash
    // directly, the browser back/forward buttons, or a Dashboard shortcut
    // tile. hasPageViewRight is defined in rights.js.
    if (typeof hasPageViewRight === 'function' && !hasPageViewRight(pageId)) {
        isHandlingPopstate = false;
        showToast("You don't have permission to view this page.", 'warning');
        if (pageId !== 'page-dashboard') navigateTo('page-dashboard');
        return;
    }

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

    if (!isHandlingPopstate) {
        // Don't push a duplicate entry if we're already sitting on this
        // exact page (e.g. clicking the same sidebar link twice, or
        // resuming here after a refresh) — that would just clutter history
        // with entries that all do nothing when you press Back.
        const alreadyHere = history.state && history.state.page === pageId;
        if (!alreadyHere) {
            history.pushState({ page: pageId }, '', '#' + pageId);
        }
    }
    isHandlingPopstate = false;

    if (window.innerWidth <= 900) toggleSidebar(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Where to land after login or a page refresh: wherever the user actually
// was (browser history survives a refresh; the URL hash is a fallback for
// cases where it doesn't), as long as that page still genuinely exists.
function resumeLastPageId() {
    const fromState = history.state && history.state.page;
    const fromHash = location.hash ? location.hash.slice(1) : null;
    const candidate = fromState || fromHash;
    if (candidate && document.getElementById(candidate)?.classList.contains('page')) {
        return candidate;
    }
    return 'page-dashboard';
}

window.addEventListener('popstate', (event) => {
    // Only handle this once the app is actually showing (ignore stray
    // popstate events that can fire before login resolves).
    if ($('app-root').classList.contains('hidden')) return;

    if (event.state && event.state.page) {
        isHandlingPopstate = true;
        navigateTo(event.state.page);
    } else {
        // Gone back (or forward) past every entry the app itself ever
        // pushed. Land on Dashboard and push it as a genuine new entry —
        // not a replace — so this spot becomes the new floor and Back
        // keeps landing here instead of exiting the app.
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
