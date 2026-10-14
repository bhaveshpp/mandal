/* =====================================================================
 *  અભરામપરા વ્યાસ પરિવાર — common.js
 *  The ONE copy of config / API / session / header / helper code.
 *  Every page loads this file. The only thing to configure is API_URL.
 * ===================================================================== */
(function () {
  'use strict';

  /* ================== CONFIG: paste your Apps Script Web App URL ================== */
  const API_URL = 'https://script.google.com/macros/s/AKfycbyNmwPlsRFOnyhqW9hJkjeLGBTmz_bnq1Lei6AumlxPnahCgTdo-N2JX4wPI5REDsYA/exec';   // https://script.google.com/macros/s/XXXX/exec
  const COUNTRY_CODE = '91';                         // India — used for tel: and wa.me links
  /* =============================================================================== */

  const APP_NAME = 'અભરામપરા વ્યાસ પરિવાર';
  const STORE_KEY = 'abharampara_session_v2';        // only mobile, token, expiry, name — never the password
  const FLASH_KEY = 'abharampara_flash_v1';
  // Pages we are allowed to redirect to after login (whitelist → no open redirect)
  const NEXT_RE = /^(home|family|hisab|reset-password|rules|members-admin)\.html(\?year=[0-9]{4})?$/;

  /* ============================ Pure helpers (no DOM) ============================ */

  const normMobile = (v) => {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    return d.length > 10 ? d.slice(-10) : d;
  };
  const validMobile = (v) => {
    const d = normMobile(v);
    return d.length === 10 ? d : '';
  };
  const telHref = (m) => { m = validMobile(m); return m ? 'tel:+' + COUNTRY_CODE + m : ''; };
  const waHref = (m) => { m = validMobile(m); return m ? 'https://wa.me/' + COUNTRY_CODE + m : ''; };

  function safeNext(v) {
    v = String(v == null ? '' : v);
    return NEXT_RE.test(v) ? v : 'home.html';
  }

  /** Returns the 4-digit year string, or null. */
  function parseYearParam(v) {
    const s = String(v == null ? '' : v).trim();
    return /^[0-9]{4}$/.test(s) ? s : null;
  }

  /** "₹0", "-", "", "₹ 0.00" … → true (nothing paid). Letters or other digits → false. */
  function isZeroish(s) {
    return String(s == null ? '' : s).replace(/[₹,.\s\-–—0૦]/g, '') === '';
  }

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = (w) => Array.from(w)[0] || '';
    return (first(words[0]) + (words.length > 1 ? first(words[1]) : '')).toUpperCase();
  }

  function memberHaystack(m) {
    const fam = (m.family_business || []).map((f) => [f.name, f.relation, f.business, f.business_details].join(' '));
    return [m.name, m.mobile, m.mobile2, m.address, m.business, m.business_details].concat(fam).join(' ').toLowerCase();
  }
  /** Every whitespace-separated word of the query must appear somewhere in the member's text. */
  function matchesQuery(m, q) {
    q = String(q == null ? '' : q).trim().toLowerCase();
    if (!q) return true;
    const h = memberHaystack(m);
    return q.split(/\s+/).every((t) => h.indexOf(t) !== -1);
  }

  /**
   * Turns the raw ledger grid into a render plan (no DOM, so it can be unit-tested):
   *  - header cells with row-spans (a filled header cell followed by empty ones below it = merged cell)
   *  - how many left columns are sticky (serial + name, or name only)
   *  - body rows flagged `zero` when every amount cell is empty / 0
   */
  function planHisab(rows, headerRows, hasTotal) {
    const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const norm = rows.map((r) => Array.from({ length: nCols }, (_, i) => (r[i] == null ? '' : String(r[i]))));
    const hr = Math.min(headerRows, norm.length);
    const head = norm.slice(0, hr);
    const rest = norm.slice(hr);
    const total = hasTotal && rest.length ? rest.pop() : null;
    const body = rest;

    const serialRe = /^[0-9૦-૯#]{0,4}$/;
    const hasSerial = nCols > 1 && body.length > 0 &&
      body.concat(total ? [total] : []).every((r) => serialRe.test(r[0].trim()));
    const sticky = hasSerial ? 2 : 1;

    const covered = head.map((r) => r.map(() => false));
    const headCells = head.map(() => []);
    for (let i = 0; i < hr; i++) {
      for (let c = 0; c < nCols; c++) {
        if (covered[i][c]) continue;
        const text = head[i][c];
        let span = 1;
        if (text.trim() !== '') {
          while (i + span < hr && head[i + span][c].trim() === '') { covered[i + span][c] = true; span++; }
        }
        headCells[i].push({ col: c, text, rowSpan: span });
      }
    }

    const bodyRows = body.map((cells) => {
      const amounts = cells.slice(sticky);
      return { cells, zero: amounts.length > 0 && amounts.every(isZeroish) };
    });

    return { nCols, sticky, hasSerial, headCells, bodyRows, total, totalCol: nCols - 1, headerRows: hr };
  }

  const pure = { normMobile, validMobile, telHref, waHref, safeNext, parseYearParam, isZeroish, initials, matchesQuery, planHisab };

  if (typeof module !== 'undefined' && module.exports) module.exports = pure;   // for the Node logic test
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* ================================ Browser part ================================ */

  if (window.tailwind) {
    window.tailwind.config = {
      theme: {
        extend: {
          colors: {
            ink: '#14302B', paper: '#F6F7F2', line: '#D9DED3',
            turmeric: { DEFAULT: '#E0A100', dark: '#9A6F00', soft: '#FBF0CC' }, danger: '#B3261E'
          },
          fontFamily: { sans: ['"Hind Vadodara"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'] }
        }
      }
    };
  }

  const $ = (id) => document.getElementById(id);

  /** Tiny DOM builder. Text is always inserted as text nodes (never innerHTML). */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    kids.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  }

  /* ------------------------------- Session ------------------------------- */
  let session = null;

  function loadSession() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.mobile && s.token && s.exp > Date.now()) return s;
    } catch (_) { /* corrupt or blocked storage */ }
    return null;
  }
  function saveSession(s) {
    session = s;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
  }
  function clearSession() {
    session = null;
    try { localStorage.removeItem(STORE_KEY); } catch (_) { /* ignore */ }
  }
  const getSession = () => session;

  /* --------------------------- Toasts and flash --------------------------- */
  function toast(message, type = 'success') {
    let box = $('toasts');
    if (!box) {
      box = el('div', {
        id: 'toasts', 'aria-live': 'polite',
        class: 'pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4',
        style: 'padding-top:max(.75rem, env(safe-area-inset-top))'
      });
      document.body.appendChild(box);
    }
    const t = el('div', { role: type === 'error' ? 'alert' : 'status', class: 'toast ' + (type === 'error' ? 'toast-err' : 'toast-ok'), text: message });
    box.appendChild(t);
    setTimeout(() => t.remove(), type === 'error' ? 5000 : 3000);
  }

  function flash(message, type = 'success') {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type })); } catch (_) { /* ignore */ }
  }
  function showFlash() {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (!raw) return;
      sessionStorage.removeItem(FLASH_KEY);
      const f = JSON.parse(raw);
      if (f && f.message) toast(String(f.message), f.type === 'error' ? 'error' : 'success');
    } catch (_) { /* ignore */ }
  }

  /* ---------------------------- Unsaved-changes guard ---------------------------- */
  let dirtyFn = () => false;
  let leaving = false;
  const setDirtyGuard = (fn) => { dirtyFn = fn; };
  window.addEventListener('beforeunload', (e) => {
    if (!leaving && dirtyFn()) { e.preventDefault(); e.returnValue = ''; }
  });
  const UNSAVED_MSG = 'Unsaved changes will be lost. Leave anyway?\nસાચવ્યા વગરના ફેરફારો જશે. બહાર નીકળવું છે?';
  function okToLeave() {
    if (!dirtyFn()) return true;
    if (confirm(UNSAVED_MSG)) { leaving = true; return true; }
    return false;
  }

  /* ---------------------------------- API ---------------------------------- */
  class ApiError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const isAuthError = (err) => !!err && err.code === 'session_expired';

  async function api(action, payload = {}) {
    if (API_URL.indexOf('PASTE_') === 0) {
      throw new ApiError('config', 'API_URL is not set in common.js yet.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      // text/plain keeps this a "simple" request → no CORS preflight (Apps Script can't answer OPTIONS)
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, payload)),
        signal: ctrl.signal
      });
    } catch (_) {
      throw new ApiError('network', 'Network problem. Check your internet and try again. / ઇન્ટરનેટ તપાસો.');
    } finally {
      clearTimeout(timer);
    }
    let data;
    try { data = await res.json(); }
    catch (_) { throw new ApiError('bad_response', 'Unexpected server response. Please try again.'); }
    if (!data.success) {
      const err = new ApiError(data.error || 'error', data.message || 'Something went wrong.');
      if (err.code === 'session_expired') expireSession();
      throw err;
    }
    return data;
  }

  /** Authenticated call: adds mobile + token from the stored session. */
  function call(action, payload = {}) {
    if (!session) throw new ApiError('session_expired', 'Session expired. Please login again.');
    // Admin payloads must not carry their own `mobile` (it would replace the logged-in one) → members use `member_mobile`.
    return api(action, Object.assign({}, payload, { mobile: session.mobile, token: session.token })).then((d) => {
      if (d && d.role && session && session.role !== d.role) saveSession(Object.assign({}, session, { role: d.role }));
      return d;
    });
  }
  const isAdmin = () => !!session && session.role === 'Admin';

  /* ------------------------- Login / redirects / logout ------------------------- */
  function currentTarget() {
    const page = (location.pathname.split('/').pop() || '') + location.search;
    return NEXT_RE.test(page) ? page : 'home.html';
  }

  /** Call first on every page except index.html. Returns the session or null (and redirects). */
  function requireLogin() {
    const s = loadSession();
    if (!s) {
      location.replace('index.html?next=' + encodeURIComponent(currentTarget()));
      return null;
    }
    session = s;
    showFlash();
    return s;
  }

  function expireSession() {
    leaving = true;
    clearSession();
    flash('Session expired. Please login again. / ફરી લોગિન કરો.', 'error');
    location.replace('index.html?next=' + encodeURIComponent(currentTarget()));
  }

  function logout() {
    leaving = true;
    clearSession();
    flash('Logged out. / લોગઆઉટ થયા.');
    location.replace('index.html');
  }
  function confirmLogout() {
    if (okToLeave()) logout();
  }

  /* ---------------------------------- UI utils ---------------------------------- */
  function setBusy(btn, busy) {
    btn.disabled = busy;
    const spin = btn.querySelector('[data-spin]');
    if (spin) spin.classList.toggle('hidden', !busy);
  }
  const show = (id, on) => { const n = $(id); if (n) n.hidden = !on; };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const input = $(t.dataset.toggle);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    t.textContent = reveal ? 'છુપાવો / Hide' : 'બતાવો / Show';
  });

  /* ------------------------------- Dropdown menus ------------------------------- */
  const closers = [];
  function closeMenus(except) { closers.forEach((c) => { if (c !== except) c(); }); }
  function bindMenu(btn, panel) {
    const close = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = !panel.hidden;
      closeMenus();
      if (!wasOpen) { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    });
    panel.addEventListener('click', (e) => e.stopPropagation());
    closers.push(close);
  }
  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  /* ---------------------------------- Modal ---------------------------------- */
  /** Simple centred dialog. Returns close(). Click outside or Esc closes it. */
  function openModal(title, content) {
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modal__head' }, el('h2', { class: 'modal__title' }, title),
        el('button', { type: 'button', class: 'modal__x', 'aria-label': 'Close', onclick: close }, '✕')),
      content);
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    return close;
  }

  /** Admin: create a new yearly ledger (year, first / last month, meeting day). Opens it afterwards. */
  function openNewYearModal() {
    const now = new Date().getFullYear();
    const yr = el('input', { class: 'field', type: 'number', min: '2000', max: '2100', value: String(now + 1), id: 'nyYear' });
    const m1 = el('input', { class: 'field', type: 'number', min: '1', max: '12', value: '1', id: 'nyFirst' });
    const m2 = el('input', { class: 'field', type: 'number', min: '1', max: '12', value: '12', id: 'nyLast' });
    const dd = el('input', { class: 'field', type: 'number', min: '1', max: '31', value: '12', id: 'nyDay' });
    const save = el('button', { type: 'submit', class: 'btn btn-primary w-full mt-4' }, el('span', { 'data-spin': '', class: 'spinner hidden' }), 'બનાવો / Create');
    let close;
    const form = el('form', { novalidate: true },
      el('p', { class: 'text-sm', style: 'color:rgba(20,48,43,.7)' }, 'સક્રિય સભ્યોની યાદી સાથે નવું વર્ષ બનશે. / A new year ledger is created with the active members.'),
      el('label', { class: 'lbl', for: 'nyYear' }, 'વર્ષ / Year'), yr,
      el('div', { class: 'grid grid-cols-2 gap-3' },
        el('div', {}, el('label', { class: 'lbl', for: 'nyFirst' }, 'પહેલો મહિનો / First month (1–12)'), m1),
        el('div', {}, el('label', { class: 'lbl', for: 'nyLast' }, 'છેલ્લો મહિનો / Last month (1–12)'), m2)),
      el('label', { class: 'lbl', for: 'nyDay' }, 'મંડળની તારીખ (દિવસ) / Meeting day of month'), dd, save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(save, true);
      try {
        const d = await call('admin_create_year', { year: Number(yr.value), first_month: Number(m1.value), last_month: Number(m2.value), day: Number(dd.value) });
        close();
        flash('નવું વર્ષ બન્યું / Year created: ' + d.sheet_name);
        location.replace('hisab.html?year=' + d.year);
      } catch (err) { if (!isAuthError(err)) toast(err.message, 'error'); setBusy(save, false); }
    });
    close = openModal('નવું વર્ષ / New year', form);
  }

  /* --------------------------------- Headers --------------------------------- */
  const guardLink = (e) => { if (!okToLeave()) e.preventDefault(); };

  /** Small header for family / hisab / reset-password / rules: Back + Logout only. */
  function renderSubHeader(host) {
    host.className = 'app-header';
    host.replaceChildren(
      el('div', { class: 'app-header__bar' },
        el('a', { class: 'btn btn-header', href: 'home.html', onclick: guardLink }, '← પાછા / Back'),
        el('span', { class: 'app-title', style: 'font-size:.95rem;text-align:center;flex:1' }, APP_NAME),
        el('button', { type: 'button', class: 'btn btn-header', onclick: confirmLogout }, 'લોગઆઉટ / Logout')
      )
    );
  }

  /** Landing-page header: app name, Hisab ▾ years, Family Members, Rules, avatar menu. */
  function renderHomeHeader(host) {
    host.className = 'app-header';

    const years = el('div', { class: 'menu-panel', role: 'menu' });
    const hisabBtn = el('button', { type: 'button', class: 'nav-btn' }, 'હિસાબ / Hisab ▾');
    const hisabWrap = el('div', { class: 'menu-wrap' }, hisabBtn, years);
    bindMenu(hisabBtn, years);

    const profilePanel = el('div', { class: 'menu-panel menu-panel--right', role: 'menu' },
      el('div', { class: 'menu-note', style: 'font-weight:600' }, session ? session.name || session.mobile : '',
        isAdmin() ? el('span', { class: 'admin-tag' }, 'અધ્યક્ષ / Admin') : null),
      isAdmin() ? el('a', { class: 'menu-item', role: 'menuitem', href: 'members-admin.html' }, 'સભ્યો મેનેજ / Manage Members') : null,
      el('a', { class: 'menu-item', role: 'menuitem', href: 'family.html' }, 'ઘરના સભ્યો / Family Members'),
      el('a', { class: 'menu-item', role: 'menuitem', href: 'reset-password.html' }, 'પાસવર્ડ બદલો / Change Password'),
      el('button', { type: 'button', class: 'menu-item menu-item--danger', role: 'menuitem', onclick: confirmLogout }, 'લોગઆઉટ / Logout')
    );
    const avatar = el('button', { type: 'button', class: 'avatar', 'aria-label': 'Profile menu' }, initials(session && session.name));
    bindMenu(avatar, profilePanel);

    host.replaceChildren(
      el('div', { class: 'app-header__bar' },
        el('h1', { class: 'app-title' }, APP_NAME),
        el('div', { class: 'menu-wrap' }, avatar, profilePanel)
      ),
      el('nav', { class: 'app-nav', 'aria-label': 'Main menu' },
        hisabWrap,
        el('a', { class: 'nav-btn', href: 'family.html' }, 'ઘરના સભ્યો / Family Members'),
        el('a', { class: 'nav-btn', href: 'rules.html' }, 'નિયમો / Rules'),
        isAdmin() ? el('a', { class: 'nav-btn', href: 'members-admin.html' }, 'સભ્યો મેનેજ / Manage Members') : null
      )
    );
    loadYears(years);
  }

  async function loadYears(panel) {
    const note = (t) => el('div', { class: 'menu-note' }, t);
    panel.replaceChildren(note('લોડ થાય છે… / Loading…'));
    try {
      const d = await call('list_hisab_years');
      const list = (d.years || []).filter((y) => parseYearParam(y.year));
      const newYear = isAdmin() ? el('button', { type: 'button', class: 'menu-item', style: 'font-weight:600', onclick: () => { closeMenus(); openNewYearModal(); } }, '＋ નવું વર્ષ / New year') : null;
      if (!list.length) {
        panel.replaceChildren(note('હજી કોઈ હિસાબ નથી / No hisab yet'), newYear);
        return;
      }
      panel.replaceChildren(...list.map((y) =>
        el('a', { class: 'menu-item', role: 'menuitem', href: 'hisab.html?year=' + parseYearParam(y.year) }, String(y.sheet_name))), newYear);
    } catch (err) {
      if (isAuthError(err)) return;
      panel.replaceChildren(note('લોડ થયું નહીં / Could not load'),
        el('button', { type: 'button', class: 'menu-item', onclick: () => loadYears(panel) }, 'ફરી પ્રયત્ન / Retry'));
    }
  }

  window.App = Object.assign({
    APP_NAME, COUNTRY_CODE,
    el, $, show, setBusy, toast, flash, showFlash,
    api, call, ApiError, isAuthError,
    loadSession, saveSession, clearSession, getSession,
    requireLogin, logout, confirmLogout, okToLeave, setDirtyGuard, isAdmin, openModal, openNewYearModal,
    renderSubHeader, renderHomeHeader
  }, pure);
})();
