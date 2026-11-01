import { parseImport, mergeChords, toText, fromText, stripMdLinks, markChoruses, isJunk } from './parse.js?v=20261101-2004';
import { computeLayout, pagesHTML } from './layout.js?v=20261101-2004';
import { savePdf, saveWord, sharePdf } from './export.js?v=20261101-2004';
import { buildBook, bookDates } from './songbook.js?v=20261101-2004';
import { vocalize } from './niqqud.js?v=20261101-2004';

const APP_URL = 'https://shtatlerit.github.io/Naama/';
const NAAMA_EMAIL = 'shtatlerit@gmail.com';
const DEFAULT_VOICES = ['קול ראשון', 'קול שני', 'קול שלישי', 'סופרן', 'אלט', 'כולם', 'סולו'];
const DEV = new URLSearchParams(location.search).has('dev');

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); }
function show(id) { $$('.view').forEach((v) => (v.hidden = v.id !== id)); window.scrollTo(0, 0); }

/* ---------------- storage (Firebase, or memory in ?dev) ---------------- */
let store, user = null;
async function initStore() {
  if (DEV) {
    const mem = JSON.parse(sessionStorage.getItem('dev-songs') || '{}');
    const persist = () => sessionStorage.setItem('dev-songs', JSON.stringify(mem));
    const books = JSON.parse(sessionStorage.getItem('dev-books') || '{}');
    store = {
      onUser(cb) { cb({ email: NAAMA_EMAIL, displayName: 'נעמה' }); },
      login() {}, logout() {},
      async list() { return Object.values(mem); },
      async save(s) { s.id = s.id || 'dev' + Date.now(); mem[s.id] = JSON.parse(JSON.stringify(s)); persist(); return s.id; },
      async remove(id) { delete mem[id]; persist(); },
      async getSettings() { return {}; }, async saveSettings() {},
      async listBooks() { return Object.values(books); },
      async saveBook(b) { b.id = b.id || 'devbook' + Date.now(); books[b.id] = JSON.parse(JSON.stringify(b)); sessionStorage.setItem('dev-books', JSON.stringify(books)); return b.id; },
      async removeBook(id) { delete books[id]; sessionStorage.setItem('dev-books', JSON.stringify(books)); },
    };
    return;
  }
  const V = '10.12.2';
  const [{ initializeApp }, A, F, { firebaseConfig }] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    import('./firebase-config.js?v=20261101-2004'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  A.getRedirectResult(auth).catch((e) => showLoginError(e));
  store = {
    onUser(cb) { A.onAuthStateChanged(auth, cb); },
    async login() {
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return A.signInWithRedirect(auth, provider);
        if (e.code !== 'auth/popup-closed-by-user') throw e;
      }
    },
    logout() { return A.signOut(auth); },
    async list() { const snap = await F.getDocs(F.collection(db, 'songs')); return snap.docs.map((d) => ({ ...d.data(), id: d.id })); },
    async save(s) {
      const id = s.id || (s.source?.wrkid ? `w${s.source.wrkid}_p${s.source.prfid || 0}` : 'x' + Date.now().toString(36));
      const data = JSON.parse(JSON.stringify({ ...s, id }));
      data.updatedAt = F.serverTimestamp(); data.updatedBy = user?.email || '';
      await F.setDoc(F.doc(db, 'songs', id), data);
      return id;
    },
    async remove(id) { await F.deleteDoc(F.doc(db, 'songs', id)); },
    async getSettings() { const d = await F.getDoc(F.doc(db, 'settings', 'app')); return d.exists() ? d.data() : {}; },
    async saveSettings(v) { await F.setDoc(F.doc(db, 'settings', 'app'), v, { merge: true }); },
    async listBooks() { const snap = await F.getDocs(F.collection(db, 'songbooks')); return snap.docs.map((d) => ({ ...d.data(), id: d.id })); },
    async saveBook(b) {
      const id = b.id || 'b' + Date.now().toString(36);
      const data = JSON.parse(JSON.stringify({ ...b, id })); data.updatedAt = F.serverTimestamp(); data.updatedBy = user?.email || '';
      await F.setDoc(F.doc(db, 'songbooks', id), data); return id;
    },
    async removeBook(id) { await F.deleteDoc(F.doc(db, 'songbooks', id)); },
  };
}
function showLoginError(e) {
  const m = $('#login-msg');
  if (!e) return;
  m.textContent = e.code === 'permission-denied' ? 'לחשבון הזה אין הרשאה לאפליקציה. צריך להתחבר עם אחד החשבונות המורשים.' : 'הכניסה לא הצליחה. נסי שוב. (' + (e.code || e.message) + ')';
}

/* ---------------- state ---------------- */
let songs = [];
let settings = { voices: DEFAULT_VOICES };
let cur = null;           // current song
let view = { kind: 'choir', print: 'text', layoutPick: 'one', voicing: false };
let lastLayout = null;
let lastChosen = null;
const APP_VERSION = '20261101-2004'; // set by tools/stamp.py
// Self-update: phones keep the old page for up to ~10 minutes. On every open (and when the app comes back
// to the screen) ask the server for the current version without cache; if it is newer, reload onto it.
async function checkUpdate() {
  if (APP_VERSION === 'dev' || location.search.includes('dev')) return;
  try {
    const r = await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' });
    const v = (await r.text()).trim();
    if (r.ok && v && v !== APP_VERSION && /^\d{8}-\d{4}$/.test(v) && !location.search.includes('v=' + v)) location.replace(location.pathname + '?v=' + v + location.hash);
  } catch {}
}
checkUpdate();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
const NAAMA_WA = '972509066939'; // נעמה, 050-9066939 (from the logo page)
let sortBy = 'title';

/* ---------------- home ---------------- */
function greetName() { return user?.email === NAAMA_EMAIL ? 'נעמה' : (user?.displayName || '').split(' ')[0]; }
function renderHome() {
  $('#greet').textContent = ('היי ' + (greetName() || '')).trim();
  const filter = $('#q').value.trim();
  const list = [...songs].sort((a, b) => (a[sortBy] || '').localeCompare(b[sortBy] || '', 'he'));
  const shown = filter ? list.filter((s) => (s.title + ' ' + s.performer).includes(filter)) : list;
  $('#rep').innerHTML = shown.map((s) => `<li data-row="${esc(s.id)}"><button data-id="${esc(s.id)}"><span class="t">${esc(s.title)}</span><span class="p">${esc(s.performer || '')}</span></button><button class="del" data-del="${esc(s.id)}" aria-label="מחיקת ${esc(s.title)}" title="מחיקה">🗑</button><span class="del-ask" hidden>למחוק? <button class="yes" data-del-yes="${esc(s.id)}">כן, למחוק</button> <button class="no" data-del-no>ביטול</button></span></li>`).join('');
  $('#rep-empty').hidden = songs.length > 0;
  const matches = filter ? list.filter((s) => s.title && (s.title.includes(filter) || filter.includes(s.title))) : [];
  $('#q-results').innerHTML = matches.length ? `<div class="found"><div>כבר ברפרטואר:</div>${matches.slice(0, 5).map((s) => `<button data-id="${esc(s.id)}">${esc(s.title)} <span>· ${esc(s.performer || '')}</span></button>`).join('')}</div>` : '';
}
async function loadSongs() {
  try { songs = await store.list(); } catch (e) { songs = []; if (e.code === 'permission-denied') { showLoginError(e); await store.logout(); return; } toast('לא הצלחתי לטעון את הרפרטואר'); }
  renderHome();
}

/* ---------------- song view ---------------- */
function openSong(song) {
  cur = song;
  if (cur.stanzas) markChoruses(cur.stanzas);
  cur.opts = { noNiqqud: false, transpose: 0, qrUrl: '', ...(cur.opts || {}) };
  view = { kind: 'choir', print: view.print, layoutPick: cur.opts.layoutPick || 'one', voicing: false };
  $('#song-title-bar').textContent = cur.title || 'שיר';
  $('#opt-niqqud').checked = !!cur.opts.noNiqqud;
  $('#qr-url').value = cur.opts.qrUrl || '';
  $('#edit-box').hidden = true; $('#del-confirm').hidden = true; $('#voices-hint').hidden = true;
  $('#btn-voices').textContent = 'סימון קולות';
  $('#btn-delete').hidden = !cur.id;
  $('#btn-niqqud-undo').hidden = !cur.preNiqqud;
  setSeg('[data-kind]', 'choir'); setSeg('[data-print]', view.print);
  show('v-song');
  refresh();
}
function setSeg(sel, val) { $$(sel).forEach((b) => b.classList.toggle('on', Object.values(b.dataset)[0] === val)); }

function chordsUrl() {
  const s = cur.source || {};
  if (!s.wrkid || !s.prfid) return '';
  return `https://shironet.mako.co.il/artist?type=chords&lang=1&prfid=${s.prfid}&wrkid=${s.wrkid}`;
}

function qrSvg() {
  const url = (cur.opts.qrUrl || '').trim();
  if (!url || !window.qrcode) return '';
  try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { return ''; }
}

function refresh() {
  const naama = view.kind === 'naama';
  $('#tab-naama').disabled = !cur.hasChords;
  $('#tab-naama').title = cur.hasChords ? '' : 'לשיר הזה עוד אין אקורדים';
  const cu = chordsUrl();
  $('#get-chords').hidden = cur.hasChords || !cu; if (cu) $('#get-chords').href = cu;
  $('#btn-spotify').href = 'https://open.spotify.com/search/' + encodeURIComponent([cur.title, cur.performer].filter(Boolean).join(' '));
  $('#transpose').hidden = !naama; $('#tr-val').textContent = (cur.opts.transpose > 0 ? '+' : '') + cur.opts.transpose;

  const opts = { chords: naama, transpose: cur.opts.transpose, noNiqqud: cur.opts.noNiqqud, full: view.print === 'full', qrSvg: qrSvg() };
  lastLayout = computeLayout(cur, opts);
  const lc = $('#layout-choice');
  const one = lastLayout.onePage, two = lastLayout.twoPages;
  let pick = view.layoutPick;
  if (!one) pick = 'two'; else if (!two) pick = 'one';
  if (one && two) {
    lc.hidden = false;
    lc.innerHTML = `השיר ארוך. מה עדיף?
      <button class="btn small ${pick === 'one' ? 'primary' : 'ghost'}" data-pick="one">עמוד אחד (גודל ${one.font})</button>
      <button class="btn small ${pick === 'two' ? 'primary' : 'ghost'}" data-pick="two">שני עמודים (גודל ${two.font})</button>`;
  } else lc.hidden = true;
  const chosen = pick === 'two' ? two : one;
  lastChosen = chosen;
  const pv = $('#preview');
  pv.classList.toggle('text-only', view.print === 'text');
  pv.classList.toggle('voicing', view.voicing);
  if (!chosen) { pv.innerHTML = '<p class="hint">השיר ארוך מדי גם לשני עמודים. נסי עריכת הטקסט.</p>'; return; }
  pv.innerHTML = pagesHTML(chosen).split('</section>').filter((x) => x.trim()).map((h, i, arr) => `<div class="pv-label">${arr.length > 1 ? 'עמוד ' + (i + 1) + ' · ' : ''}גודל כתב ${chosen.font}</div><div class="pv-wrap">${h}</section></div>`).join('');
  scalePreview();
  $('#print-root').innerHTML = pagesHTML(chosen);
}
function scalePreview(sel = '#preview') {
  const pv = $(sel);
  const w = Math.min(pv.clientWidth, 820);
  pv.querySelectorAll('.pv-wrap').forEach((wrap) => {
    const page = wrap.querySelector('.page');
    const pw = page.offsetWidth, ph = page.offsetHeight;
    const sc = Math.min(1, w / pw);
    page.style.transform = `scale(${sc})`;
    wrap.style.width = pw * sc + 'px'; wrap.style.height = ph * sc + 'px';
  });
}
addEventListener('resize', () => { if (!$('#v-song').hidden) scalePreview(); if (!$('#v-book').hidden) scalePreview('#bk-preview'); });

let saveTimer;
function scheduleSave() {
  $('#save-state').textContent = 'שומרת…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      cur.id = await store.save(cur);
      const i = songs.findIndex((s) => s.id === cur.id); if (i >= 0) songs[i] = cur; else songs.push(cur);
      $('#save-state').textContent = 'נשמר ברפרטואר'; $('#btn-delete').hidden = false;
    } catch (e) { $('#save-state').textContent = 'לא נשמר'; toast('השמירה לא הצליחה (' + (e.code || e.message) + ')'); }
  }, 700);
}

/* ---------------- import (from the Shironet button or a paste) ---------------- */
function readImportFromHash() {
  const h = location.hash;
  if (!h.startsWith('#import=')) return null;
  try { const d = JSON.parse(decodeURIComponent(h.slice(8))); history.replaceState(null, '', location.pathname + location.search); return d; }
  catch { history.replaceState(null, '', location.pathname + location.search); toast('לא הצלחתי לקרוא את השיר משירונט'); return null; }
}
function handleImport(data) {
  const song = parseImport(data);
  if (!song.stanzas.length) { toast('לא מצאתי מילים בדף הזה. נסי מדף השיר עצמו, או הדבקה ידנית.'); return; }
  const s = song.source || {};
  const existing = s.wrkid ? songs.find((x) => x.source?.wrkid === s.wrkid && x.source?.prfid === s.prfid) : null;
  if (existing && s.type === 'chords') { openSong(mergeChords(existing, song)); toast('האקורדים נוספו לשיר'); scheduleSave(); return; }
  if (existing) {
    // A newer import may read the header better (e.g. a fix in the title rules): refresh a wrong or missing header.
    const better = song.title && (isJunk(existing.title || '') || (song.credits.length && (!existing.credits?.length || existing.title !== song.title)));
    if (better) { existing.title = song.title; existing.performer = song.performer; if (song.credits.length) existing.credits = song.credits; scheduleSave(); }
    openSong(existing); toast(better ? 'השיר כבר ברפרטואר – עדכנתי את השם והקרדיטים' : 'השיר כבר ברפרטואר'); return;
  }
  song.createdAt = new Date().toISOString();
  openSong(song); scheduleSave();
}

/* ---------------- voices ---------------- */
function openVoiceMenu(lineEl, x, y) {
  const si = +lineEl.dataset.s, li = +lineEl.dataset.l;
  const st = cur.stanzas[si]; if (!st) return;
  const m = $('#voice-menu');
  const voices = settings.voices || DEFAULT_VOICES;
  m.innerHTML = voices.map((v) => `<button data-v="${esc(v)}">${esc(v)}</button>`).join('') +
    `<button data-v="">ללא סימון</button><button data-v="__stanza">סימון לכל הבית…</button><button class="edit" data-v="__edit">עריכת רשימת הקולות</button>`;
  m.hidden = false;
  m.style.left = Math.min(x, innerWidth - 170) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 10) + 'px';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    let v = b.dataset.v;
    if (v === '__edit') {
      m.innerHTML = `<label class="small-label" for="vl">קולות, מופרדים בפסיק</label><input id="vl" value="${esc(voices.join(', '))}"><button data-v="__savelist">שמירה</button>`;
      m.querySelector('#vl').focus(); return;
    }
    if (v === '__savelist') {
      settings.voices = m.querySelector('#vl').value.split(',').map((x) => x.trim()).filter(Boolean);
      m.hidden = true; try { await store.saveSettings({ voices: settings.voices }); } catch {}
      return;
    }
    if (v === '__stanza') { m.innerHTML = voices.map((x) => `<button data-v="__all:${esc(x)}">${esc(x)}</button>`).join('') + '<button data-v="__all:">ללא סימון</button>'; return; }
    if (v.startsWith('__all:')) { v = v.slice(6); st.lines.forEach((l) => (v ? (l.voice = v) : delete l.voice)); }
    else if (v) st.lines[li].voice = v; else delete st.lines[li].voice;
    m.hidden = true; refresh(); scheduleSave();
  };
}
document.addEventListener('click', (e) => { const m = $('#voice-menu'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('.ln')) m.hidden = true; });

/* ---------------- speech ---------------- */
function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#mic-hint').hidden = false; return; }
  const btn = $('#btn-mic'); btn.hidden = false;
  let rec = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'he-IL'; rec.interimResults = true; rec.maxAlternatives = 1;
    btn.classList.add('rec');
    rec.onresult = (e) => { $('#q').value = [...e.results].map((r) => r[0].transcript).join(' ').replace(/[.?!]$/, ''); renderHome(); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') toast('צריך לאשר גישה למיקרופון'); else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('הזיהוי הקולי לא עבד. אפשר להקליד.'); };
    rec.onend = () => { btn.classList.remove('rec'); rec = null; };
    rec.start();
  };
}

/* ---------------- wiring ---------------- */
function wire() {
  $('#btn-login').onclick = async () => { $('#login-msg').textContent = ''; try { await store.login(); } catch (e) { showLoginError(e); } };
  $('#btn-logout').onclick = () => store.logout();
  $('#q').addEventListener('input', renderHome);
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-shironet').click(); });
  $('#btn-shironet').onclick = () => {
    const q = $('#q').value.trim();
    if (!q) { $('#q').focus(); toast('כתבי או אמרי קודם את שם השיר'); return; }
    const url = 'https://shironet.mako.co.il/search?q=' + encodeURIComponent(q);
    // From the iPhone home-screen app, links open in a small in-app browser that has no bookmarks,
    // so the "עצב לנעמה" button cannot be used there. x-safari-https:// opens the real Safari (iOS 17+).
    // On iPhone the button lives only in Safari (Chrome for iPhone cannot run it), so always hand off to Safari.
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (iphone) location.href = 'x-safari-' + url;
    else window.open(url, '_blank', 'noopener');
  };
  $('#btn-paste-toggle').onclick = () => { $('#paste-box').hidden = !$('#paste-box').hidden; if (!$('#paste-box').hidden) $('#paste').focus(); };
  $('#btn-paste-go').onclick = () => { const t = $('#paste').value; if (!t.trim()) return; handleImport({ text: t }); $('#paste').value = ''; $('#paste-box').hidden = true; };
  $('#rep').onclick = $('#q-results').onclick = async (e) => {
    const row = e.target.closest('li[data-row]');
    if (e.target.closest('[data-del]')) { row.querySelector('.del-ask').hidden = false; e.target.closest('[data-del]').hidden = true; return; }
    if (e.target.closest('[data-del-no]')) { row.querySelector('.del-ask').hidden = true; row.querySelector('[data-del]').hidden = false; return; }
    const yes = e.target.closest('[data-del-yes]');
    if (yes) {
      const id = yes.dataset.delYes; yes.disabled = true;
      try { await store.remove(id); songs = songs.filter((x) => x.id !== id); toast('השיר נמחק מהרפרטואר'); renderHome(); }
      catch { yes.disabled = false; toast('המחיקה לא הצליחה'); }
      return;
    }
    const b = e.target.closest('button[data-id]'); if (b) openSong(songs.find((s) => s.id === b.dataset.id));
  };
  $$('[data-sort]').forEach((b) => (b.onclick = () => { sortBy = b.dataset.sort; setSeg('[data-sort]', sortBy); renderHome(); }));

  $('#btn-back').onclick = () => { show('v-home'); renderHome(); };
  wireBook();
  $$('[data-kind]').forEach((b) => (b.onclick = () => { if (b.disabled) return; view.kind = b.dataset.kind; setSeg('[data-kind]', view.kind); refresh(); }));
  $$('[data-print]').forEach((b) => (b.onclick = () => { view.print = b.dataset.print; setSeg('[data-print]', view.print); refresh(); }));
  $('#opt-niqqud').onchange = (e) => { cur.opts.noNiqqud = e.target.checked; refresh(); scheduleSave(); };
  $$('[data-tr]').forEach((b) => (b.onclick = () => { cur.opts.transpose = Math.max(-11, Math.min(11, cur.opts.transpose + +b.dataset.tr)); refresh(); scheduleSave(); }));
  $('#layout-choice').onclick = (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; view.layoutPick = cur.opts.layoutPick = b.dataset.pick; refresh(); scheduleSave(); };
  let qrT; $('#qr-url').oninput = (e) => { clearTimeout(qrT); qrT = setTimeout(() => { cur.opts.qrUrl = e.target.value.trim(); refresh(); scheduleSave(); }, 500); };
  $('#btn-voices').onclick = () => { view.voicing = !view.voicing; $('#btn-voices').textContent = view.voicing ? 'סיום סימון קולות' : 'סימון קולות'; $('#voices-hint').hidden = !view.voicing; $('#preview').classList.toggle('voicing', view.voicing); };
  $('#preview').onclick = (e) => { if (!view.voicing) return; const ln = e.target.closest('.ln'); if (ln) openVoiceMenu(ln, e.clientX, e.clientY); };
  $('#btn-edit').onclick = () => {
    $('#ed-title').value = cur.title || ''; $('#ed-perf').value = cur.performer || '';
    $('#ed-cred').value = (cur.credits || []).map((c) => `${c.label}: ${c.value}`).join(' | ');
    $('#ed-text').value = toText(cur); $('#edit-box').hidden = false;
  };
  $('#btn-ed-cancel').onclick = () => ($('#edit-box').hidden = true);
  $('#btn-ed-save').onclick = () => {
    const next = fromText(cur, $('#ed-text').value);
    next.title = $('#ed-title').value.trim(); next.performer = $('#ed-perf').value.trim();
    next.credits = $('#ed-cred').value.split('|').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return i > 0 ? { label: x.slice(0, i).trim(), value: x.slice(i + 1).trim() } : { label: 'קרדיט', value: x }; });
    Object.assign(cur, next); $('#song-title-bar').textContent = cur.title; $('#edit-box').hidden = true; refresh(); scheduleSave();
  };
  $('#btn-delete').onclick = () => ($('#del-confirm').hidden = false);
  $('#btn-del-no').onclick = () => ($('#del-confirm').hidden = true);
  $('#btn-del-yes').onclick = async () => { try { await store.remove(cur.id); songs = songs.filter((s) => s.id !== cur.id); toast('השיר נמחק'); show('v-home'); renderHome(); } catch { toast('המחיקה לא הצליחה'); } };
  $('#btn-print').onclick = () => { refresh(); setTimeout(() => window.print(), 50); };
  const fileBase = () => (cur.title || 'שיר') + (view.kind === 'naama' ? ' - אקורדים' : '');
  const busy = async (btn, label, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = label; try { await fn(); } catch (e) { console.error(e); toast('השמירה לא הצליחה. נסי שוב.'); } finally { btn.disabled = false; btn.textContent = t; } };
  $('#btn-pdf').onclick = (e) => busy(e.currentTarget, 'מכינה PDF…', async () => { refresh(); if (lastChosen) await savePdf(pagesHTML(lastChosen), view.print === 'full', fileBase()); });
  // WhatsApp: a link cannot attach a file, so the PDF goes through the share sheet (choose WhatsApp → נעמה).
  // Where sharing files is not supported, the PDF is downloaded and WhatsApp opens on Naama's chat to attach it.
  $('#btn-wa').onclick = (e) => busy(e.currentTarget, 'מכינה PDF…', async () => {
    refresh(); if (!lastChosen) return;
    const r = await sharePdf(pagesHTML(lastChosen), view.print === 'full', fileBase(), cur.title || '');
    if (r === 'again') toast('ה-PDF מוכן. לחצי שוב על "שליחה לנעמה בוואטסאפ".', 6000);
    if (r === 'unsupported') {
      toast('ה-PDF ירד למחשב. בוואטסאפ שנפתח, צרפי אותו בשיחה (📎).', 7000);
      window.open('https://wa.me/' + NAAMA_WA + '?text=' + encodeURIComponent(cur.title || ''), '_blank', 'noopener');
    }
  });
  $('#btn-word').onclick = (e) => busy(e.currentTarget, 'מכינה Word…', async () => { refresh(); if (lastChosen) await saveWord(cur, lastChosen, view.print === 'full', fileBase()); });
  $('#btn-niqqud').onclick = async (e) => {
    const btn = e.currentTarget;
    const lines = cur.stanzas.flatMap((s) => s.lines).filter((l) => l.t.trim());
    const text = [cur.title, ...lines.map((l) => l.t)].join('\n');
    btn.disabled = true; btn.textContent = 'מנקדת…';
    try {
      const out = (await vocalize(text)).split('\n');
      if (out.length !== lines.length + 1) throw new Error('lines mismatch ' + out.length + '/' + (lines.length + 1));
      cur.preNiqqud = { title: cur.title, lines: lines.map((l) => l.t) };
      cur.title = out[0].trim() || cur.title;
      lines.forEach((l, i) => { l.t = out[i + 1].trim() || l.t; });
      cur.opts.noNiqqud = false; $('#opt-niqqud').checked = false;
      $('#btn-niqqud-undo').hidden = false; $('#song-title-bar').textContent = cur.title;
      refresh(); scheduleSave(); toast('השיר נוקד. כדאי לעבור על הניקוד לפני הדפסה.');
    } catch (err) {
      console.warn(err);
      try { await navigator.clipboard.writeText(text); } catch {}
      toast('הניקוד האוטומטי לא זמין כרגע. העתקתי את השיר; הדביקי באתר דיקטה ואז ב"עריכת הטקסט".', 6000);
      window.open('https://nakdan.dicta.org.il/', '_blank', 'noopener');
    } finally { btn.disabled = false; btn.textContent = 'ניקוד אוטומטי'; }
  };
  $('#btn-niqqud-undo').onclick = () => {
    const p = cur.preNiqqud; if (!p) return;
    const lines = cur.stanzas.flatMap((s) => s.lines).filter((l) => l.t.trim());
    if (lines.length === p.lines.length) lines.forEach((l, i) => (l.t = p.lines[i]));
    cur.title = p.title; delete cur.preNiqqud; $('#btn-niqqud-undo').hidden = true; $('#song-title-bar').textContent = cur.title;
    refresh(); scheduleSave();
  };
  addEventListener('hashchange', () => { const d = readImportFromHash(); if (d && user) handleImport(d); });
}

/* ---------------- boot ---------------- */
async function boot() {
  wire(); setupMic();
  const pending = readImportFromHash();
  if (pending) sessionStorage.setItem('pending-import', JSON.stringify(pending));
  try { await initStore(); } catch (e) { show('v-login'); $('#login-msg').textContent = 'אין חיבור לשרת. בדקי את האינטרנט ונסי שוב.'; return; }
  store.onUser(async (u) => {
    user = u;
    if (!u) { show('v-login'); return; }
    show('v-home');
    await loadSongs();
    try { const st = await store.getSettings(); if (st.voices?.length) settings.voices = st.voices; } catch {}
    const p = sessionStorage.getItem('pending-import');
    if (p) { sessionStorage.removeItem('pending-import'); handleImport(JSON.parse(p)); }
  });
}
boot();

/* ---------------- songbook ---------------- */
let books = [], book = null, bookHtml = '', bookTimer;
const newBook = () => ({ title: '', date: '', songIds: [], toc: true, pair: true, version: 'choir', full: true, copies: 1 });
async function openBooks() {
  show('v-book');
  try { books = await store.listBooks(); } catch { books = []; toast('לא הצלחתי לטעון את השירונים'); }
  books.sort((a, b) => String(b.updatedAt?.seconds || b.id).localeCompare(String(a.updatedAt?.seconds || a.id)));
  if (!book) book = books[0] ? books[0] : newBook();
  renderBook();
}
function bookChanged() {
  bookHtml = ''; ['#bk-print', '#bk-pdf', '#bk-wa'].forEach((b) => ($(b).disabled = true));
  $('#bk-preview').innerHTML = ''; $('#bk-status').textContent = '';
  $('#book-save').textContent = 'שומרת…';
  clearTimeout(bookTimer);
  bookTimer = setTimeout(async () => {
    try {
      book.id = await store.saveBook(book);
      const i = books.findIndex((b) => b.id === book.id); if (i >= 0) books[i] = book; else books.unshift(book);
      $('#book-save').textContent = 'נשמר'; renderBookList();
    } catch (e) { $('#book-save').textContent = 'לא נשמר'; }
  }, 700);
}
function renderBookList() {
  $('#book-list').innerHTML = books.map((b) => `<li data-row="${esc(b.id)}"><button data-book="${esc(b.id)}"><span class="t">${esc(b.title || 'שירון בלי שם')}${b.id === book?.id ? ' ✓' : ''}</span><span class="p">${(b.songIds || []).length} שירים${b.date ? ' · ' + esc(bookDates(b.date)?.hebrew || '') : ''}</span></button><button class="del" data-bdel="${esc(b.id)}" aria-label="מחיקת השירון" title="מחיקה">🗑</button><span class="del-ask" hidden>למחוק את השירון? <button class="yes" data-bdel-yes="${esc(b.id)}">כן, למחוק</button> <button class="no" data-bdel-no>ביטול</button></span></li>`).join('');
  $('#book-list-empty').hidden = books.length > 0;
}
function renderBook() {
  renderBookList();
  $('#bk-title').value = book.title || '';
  $('#bk-date').value = book.date || '';
  const d = bookDates(book.date);
  $('#bk-date-he').textContent = d ? d.hebrew + '  ·  ' + d.greg : 'התאריך העברי והלועזי יחושבו לבד.';
  setSeg('[data-bkver]', book.version); setSeg('[data-bkprint]', book.full ? 'full' : 'text');
  $('#bk-copies-wrap').hidden = book.version !== 'chords'; $('#bk-copies').value = book.copies || 1;
  $('#bk-toc').checked = book.toc !== false; $('#bk-pair').checked = book.pair !== false;
  const byId = new Map(songs.map((x) => [x.id, x]));
  const chosen = (book.songIds || []).filter((id) => byId.has(id));
  $('#bk-chosen').innerHTML = chosen.map((id, i) => { const x = byId.get(id); return `<li><span class="t">${esc(x.title)} <span>${esc(x.performer || '')}</span></span>
    <button data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="למעלה">▲</button><button data-down="${i}" ${i === chosen.length - 1 ? 'disabled' : ''} aria-label="למטה">▼</button><button data-out="${i}" aria-label="הוצאה מהשירון">✕</button></li>`; }).join('');
  $('#bk-chosen-empty').hidden = chosen.length > 0;
  const q = $('#bk-q').value.trim();
  const pick = [...songs].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'he')).filter((x) => !q || (x.title + ' ' + (x.performer || '')).includes(q));
  $('#bk-pick').innerHTML = pick.map((x) => `<li><button data-add="${esc(x.id)}"><span class="t">${esc(x.title)}</span><span class="p">${chosen.includes(x.id) ? '<span class="in">✓ בשירון</span>' : esc(x.performer || '')}</span></button></li>`).join('');
}
function wireBook() {
  $('#btn-book').onclick = openBooks;
  $('#book-back').onclick = () => { show('v-home'); renderHome(); };
  $('#book-new').onclick = () => { book = newBook(); renderBook(); bookChanged(); };
  $('#book-list').onclick = async (e) => {
    const row = e.target.closest('li[data-row]');
    if (e.target.closest('[data-bdel]')) { row.querySelector('.del-ask').hidden = false; return; }
    if (e.target.closest('[data-bdel-no]')) { row.querySelector('.del-ask').hidden = true; return; }
    const y = e.target.closest('[data-bdel-yes]');
    if (y) { const id = y.dataset.bdelYes; try { await store.removeBook(id); books = books.filter((b) => b.id !== id); if (book?.id === id) book = books[0] || newBook(); renderBook(); toast('השירון נמחק'); } catch { toast('המחיקה לא הצליחה'); } return; }
    const b = e.target.closest('[data-book]'); if (b) { book = books.find((x) => x.id === b.dataset.book); bookChanged(); renderBook(); }
  };
  $('#bk-title').oninput = () => { book.title = $('#bk-title').value; bookChanged(); renderBookList(); };
  $('#bk-date').onchange = () => { book.date = $('#bk-date').value; bookChanged(); renderBook(); };
  $$('[data-bkver]').forEach((b) => (b.onclick = () => { book.version = b.dataset.bkver; bookChanged(); renderBook(); }));
  $$('[data-bkprint]').forEach((b) => (b.onclick = () => { book.full = b.dataset.bkprint === 'full'; bookChanged(); renderBook(); }));
  $('#bk-copies').onchange = () => { book.copies = Math.max(1, Math.min(20, +$('#bk-copies').value || 1)); bookChanged(); };
  $('#bk-toc').onchange = () => { book.toc = $('#bk-toc').checked; bookChanged(); };
  $('#bk-pair').onchange = () => { book.pair = $('#bk-pair').checked; bookChanged(); };
  $('#bk-q').oninput = renderBook;
  $('#bk-pick').onclick = (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const id = b.dataset.add; book.songIds = book.songIds || [];
    if (book.songIds.includes(id)) book.songIds = book.songIds.filter((x) => x !== id); else book.songIds.push(id);
    bookChanged(); renderBook();
  };
  $('#bk-chosen').onclick = (e) => {
    const ids = book.songIds.filter((id) => songs.some((x) => x.id === id));
    const b = e.target.closest('button'); if (!b) return;
    const i = +(b.dataset.up ?? b.dataset.down ?? b.dataset.out);
    if (b.dataset.up != null && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    else if (b.dataset.down != null && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
    else if (b.dataset.out != null) ids.splice(i, 1);
    book.songIds = ids; bookChanged(); renderBook();
  };
  $('#bk-build').onclick = async (e) => {
    if (!(book.songIds || []).length) { toast('בחרי קודם שירים לשירון'); return; }
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const r = await buildBook(book, songs, (i, n) => { btn.textContent = `מכינה… ${i}/${n}`; });
      bookHtml = r.html;
      const pv = $('#bk-preview');
      pv.classList.toggle('text-only', !book.full);
      pv.innerHTML = r.html.split('</section>').filter((x) => x.trim()).map((h) => `<div class="pv-wrap">${h}</section></div>`).join('');
      scalePreview('#bk-preview');
      $('#bk-status').textContent = `השירון מוכן: ${r.pageCount} עמודים.` + (r.skipped.length ? ` לא נכנסו (ארוכים מדי): ${r.skipped.join(', ')}` : '');
      ['#bk-print', '#bk-pdf', '#bk-wa'].forEach((b) => ($(b).disabled = false));
      pv.scrollIntoView({ behavior: 'smooth' });
    } catch (err) { console.error(err); toast('הכנת השירון לא הצליחה'); }
    finally { btn.disabled = false; btn.textContent = 'הכנת השירון'; }
  };
  const name = () => 'שירון' + (book.title ? ' - ' + book.title : '') + (book.version === 'chords' ? ' - אקורדים' : '');
  $('#bk-print').onclick = () => { $('#print-root').innerHTML = bookHtml; setTimeout(() => window.print(), 80); };
  const busyB = async (btn, label, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = label; try { await fn(); } catch (err) { console.error(err); toast('השמירה לא הצליחה. נסי שוב.'); } finally { btn.disabled = false; btn.textContent = t; } };
  $('#bk-pdf').onclick = (e) => busyB(e.currentTarget, 'מכינה PDF…', () => savePdf(bookHtml, book.full, name()));
  $('#bk-wa').onclick = (e) => busyB(e.currentTarget, 'מכינה PDF…', async () => {
    const r = await sharePdf(bookHtml, book.full, name(), book.title || 'שירון');
    if (r === 'again') toast('ה-PDF מוכן. לחצי שוב על "שליחה לנעמה בוואטסאפ".', 6000);
    if (r === 'unsupported') { toast('ה-PDF ירד. בוואטסאפ שנפתח, צרפי אותו (📎).', 7000); window.open('https://wa.me/' + NAAMA_WA + '?text=' + encodeURIComponent(book.title || 'שירון'), '_blank', 'noopener'); }
  });
}
