/**
 * TeleFlow - Storage layer, backed by Firestore.
 *
 * Every module in this app (accounts.js, items.js, dataentry.js, etc.)
 * only ever calls lfGetAll / lfUpsert / lfDelete / lfFindById — never
 * Firestore directly. That's what makes swapping the backend possible
 * without rewriting every module:
 *
 *  - lfGetAll() / lfFindById() stay SYNCHRONOUS. They read from an
 *    in-memory cache that's kept live by Firestore's onSnapshot
 *    listeners, so existing render functions don't need to become
 *    async just to display data.
 *  - lfUpsert() / lfDelete() are ASYNC (they return a Promise), since
 *    writes actually go over the network.
 *
 * Every collection lives under companies/{companyId}/... so one
 * company's data is structurally separated from every other company's.
 */

const LF_KEYS = {
    ACCOUNTS: 'accounts',
    ITEMS: 'items',
    USERS: 'users',
    RIGHTS: 'rights',
    INVOICES: 'invoices',
    ACCOUNT_LEDGER: 'accountLedger',
    LOAD_LEDGER: 'loadLedger',
    ITEM_LEDGER: 'itemLedger',
    VOUCHERS: 'vouchers',
    EDIT_LOG: 'editLog',
    RSO_CUSTOMERS: 'rsoCustomers',
    RSO_SALES: 'rsoSales',
    RSO_RETURNS: 'rsoReturns',
    RSO_RECOVERIES: 'rsoRecoveries',
    RSO_LOADS: 'rsoLoads',
    RSO_DEPOSITS: 'rsoDeposits'
};

let currentCompanyId = null;
const _cache = {};
const _listeners = {};
let _companyDocCache = null;

// ==================== COMPANY SCOPE ====================
function companyRef() {
    if (!currentCompanyId) throw new Error('No company is set — call setCurrentCompany() after login first.');
    return fbDb.collection('companies').doc(currentCompanyId);
}
function colRef(key) { return companyRef().collection(key); }

function setCurrentCompany(companyId) {
    Object.values(_listeners).forEach(unsub => unsub && unsub());
    Object.keys(_listeners).forEach(k => delete _listeners[k]);
    Object.values(LF_KEYS).forEach(key => { _cache[key] = []; });
    _companyDocCache = null;
    currentCompanyId = companyId;
}

function clearCurrentCompany() {
    Object.values(_listeners).forEach(unsub => unsub && unsub());
    Object.keys(_listeners).forEach(k => delete _listeners[k]);
    Object.values(LF_KEYS).forEach(key => { _cache[key] = []; });
    _companyDocCache = null;
    currentCompanyId = null;
}

function watchCollection(key, onChange) {
    if (_listeners[key]) return;
    _listeners[key] = colRef(key).onSnapshot(
        snapshot => {
            _cache[key] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            if (onChange) onChange();
        },
        err => console.error(`[Firestore] Listener for "${key}" failed:`, err)
    );
}

function watchCompanyDoc(onChange) {
    if (_listeners['__company']) return;
    _listeners['__company'] = companyRef().onSnapshot(
        snap => {
            _companyDocCache = snap.data() || {};
            if (onChange) onChange();
        },
        err => console.error('[Firestore] Company listener failed:', err)
    );
}

function getCompanyDoc() { return _companyDocCache || {}; }

// ==================== GENERIC CRUD ====================
function lfGetAll(key) { return _cache[key] || []; }
function lfFindById(key, id) { return lfGetAll(key).find(r => r.id === id) || null; }

async function lfUpsert(key, record) {
    const now = new Date().toISOString();
    if (!record.id) {
        record.createdAt = now;
        record.updatedAt = now;
        const ref = await colRef(key).add(record);
        await ref.update({ id: ref.id });
        record.id = ref.id;
        return record;
    }
    record.updatedAt = now;
    const { id, ...data } = record;
    await colRef(key).doc(id).set(data, { merge: true });
    return record;
}

async function lfDelete(key, id) {
    await colRef(key).doc(id).delete();
}

// ==================== SETTINGS (a field on the company document) ====================
function lfDefaultSettings() {
    return {
        companyName: '', companyLogo: '', companyPhone: '', companyEmail: '',
        companyCity: '', companyNTN: '', companyGST: '', companyAddress: '',
        currencyLabel: 'Rs.', theme: 'light'
    };
}

function lfGetSettings() {
    const data = getCompanyDoc();
    return { ...lfDefaultSettings(), ...(data.settings || {}) };
}

async function lfSaveSettings(settings) {
    await companyRef().set({ settings }, { merge: true });
}

// ==================== DOCUMENT NUMBERING (invoices, vouchers) ====================
// A running counter per document type, stored on the company document itself.
// peekNextDocNumber() is just a preview for display — takeNextDocNumber() is
// the one that actually reserves a number, using a transaction so two people
// on two different devices can never be handed the same number.
function peekNextDocNumber(type, prefix) {
    const counters = (getCompanyDoc().counters) || {};
    const next = (counters[type] || 0) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
}

async function takeNextDocNumber(type, prefix) {
    const ref = companyRef();
    const next = await fbDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const counters = (snap.data() || {}).counters || {};
        const updated = (counters[type] || 0) + 1;
        counters[type] = updated;
        tx.set(ref, { counters }, { merge: true });
        return updated;
    });
    return `${prefix}-${String(next).padStart(4, '0')}`;
}

// ==================== BULK DELETE BY invoiceId (used when editing/deleting invoices & vouchers) ====================
// Removes every ledger entry tagged with a given invoiceId across the three
// ledger collections — used so re-saving an edited invoice/voucher never
// double-posts, and deleting one cleanly removes everything it posted.
async function lfDeleteWhereInvoiceId(key, invoiceId) {
    const snap = await colRef(key).where('invoiceId', '==', invoiceId).get();
    const batch = fbDb.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    if (!snap.empty) await batch.commit();
}
