/**
 * LedgerFlow - Tools module (Edit History)
 *
 * Reads the trail every save/delete writes via logActivity() (see
 * utils.js). Each entry carries a field-level before/after diff, so this
 * screen can show not just "someone edited this voucher" but exactly
 * which values moved and what they moved from and to.
 *
 * Rendered as an expandable timeline rather than a flat table — the
 * change detail only matters once you've found the entry you care about,
 * and a table can't hold a variable-length list of field changes without
 * becoming unreadable.
 */

function initEditHistoryPage() {
    $('el-search').value = '';
    $('el-action-filter').value = '';
    renderEditHistory();
}

function renderEditHistory() {
    const container = $('el-timeline');
    if (!container) return;

    const term = ($('el-search')?.value || '').trim().toLowerCase();
    const actionFilter = $('el-action-filter')?.value || '';

    let entries = lfGetAll(LF_KEYS.EDIT_LOG);
    if (actionFilter) entries = entries.filter(e => e.action === actionFilter);
    if (term) {
        entries = entries.filter(e =>
            (e.userName || '').toLowerCase().includes(term) ||
            (e.userEmail || '').toLowerCase().includes(term) ||
            (e.entityType || '').toLowerCase().includes(term) ||
            (e.label || '').toLowerCase().includes(term) ||
            (e.changes || []).some(c => (c.label || '').toLowerCase().includes(term))
        );
    }

    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    $('el-count').textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

    if (entries.length === 0) {
        container.innerHTML = `<div class="card history-empty">
            <p>No history yet.</p>
            <p class="hint">Every change you make from here on is recorded automatically.</p>
        </div>`;
        return;
    }

    // Group by calendar day so long trails stay scannable.
    const groups = [];
    entries.forEach(e => {
        const day = new Date(e.timestamp).toDateString();
        let g = groups.find(x => x.day === day);
        if (!g) { g = { day, date: new Date(e.timestamp), items: [] }; groups.push(g); }
        g.items.push(e);
    });

    container.innerHTML = groups.map(g => `
        <div class="history-day">
            <div class="history-day-label">${escapeHtml(formatHistoryDay(g.date))}</div>
            ${g.items.map(renderHistoryEntry).join('')}
        </div>
    `).join('');
}

function formatHistoryDay(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - that) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const HISTORY_ACTION_META = {
    Created: { cls: 'is-created', verb: 'created' },
    Updated: { cls: 'is-updated', verb: 'edited' },
    Deleted: { cls: 'is-deleted', verb: 'deleted' }
};

function renderHistoryEntry(e) {
    const meta = HISTORY_ACTION_META[e.action] || { cls: '', verb: (e.action || '').toLowerCase() };
    const time = new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const who = e.userName || e.userEmail || 'Unknown';
    const changes = e.changes || [];

    // On an edit, the creator is worth showing alongside the editor —
    // "who made this originally" is usually the next question after
    // "who changed it".
    const creatorLine = (e.action === 'Updated' && e.createdBy && e.createdBy !== who)
        ? `<span class="history-creator">originally created by ${escapeHtml(e.createdBy)}</span>` : '';

    const changeRows = changes.map(c => `
        <tr>
            <td class="history-field">${escapeHtml(c.label)}</td>
            <td class="history-from">${escapeHtml(c.from)}</td>
            <td class="history-arrow">&rarr;</td>
            <td class="history-to">${escapeHtml(c.to)}</td>
        </tr>`).join('');

    const detail = changes.length ? `
        <div class="history-detail">
            <table class="history-table">
                <thead><tr><th>Field</th><th>Before</th><th></th><th>After</th></tr></thead>
                <tbody>${changeRows}</tbody>
            </table>
        </div>` : '';

    // Older entries (recorded before field-level history existed) have no
    // change list — say so plainly rather than showing an empty expander.
    const summary = changes.length
        ? `${changes.length} field${changes.length === 1 ? '' : 's'} changed`
        : 'No field detail recorded';

    const body = changes.length
        ? `<details class="history-changes">
               <summary>${summary}</summary>
               ${detail}
           </details>`
        : `<div class="history-nodetail">${summary}</div>`;

    return `
        <article class="card history-entry">
            <div class="history-entry-head">
                <span class="history-dot ${meta.cls}"></span>
                <div class="history-headline">
                    <div class="history-line">
                        <strong>${escapeHtml(who)}</strong> ${escapeHtml(meta.verb)}
                        <span class="type-badge">${escapeHtml(e.entityType)}</span>
                        ${e.label ? `<strong class="history-label">${escapeHtml(e.label)}</strong>` : ''}
                    </div>
                    ${creatorLine}
                </div>
                <span class="history-time">${escapeHtml(time)}</span>
            </div>
            ${body}
        </article>`;
}

// The nav and hub links still call the old names — keep them working so a
// rename of the screen doesn't become a rename of every call site.
function initEditLogPage() { initEditHistoryPage(); }
function renderEditLog() { renderEditHistory(); }
