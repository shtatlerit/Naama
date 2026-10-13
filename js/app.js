import { parseImport, mergeChords, toText, fromText, stripMdLinks } from './parse.js';
import { computeLayout, pagesHTML } from './layout.js';

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
    store = {
      onUser(cb) { cb({ email: NAAMA_EMAIL, displayName: 'נעמה' }); },
      login() {}, logout() {},
      async list() { return Object.values(mem); },
      async save(s) { s.id = s.id || 'dev' + Date.now(); mem[s.id] = JSON.parse(JSON.stringify(s)); persist(); return s.id; },
      async remove(id) { delete mem[id]; persist(); },
      async getSettings() { return {}; }, async saveSettings() {},
    };
    return;
  }
  const V = '10.12.2';
  const [{ initializeApp }, A, F, { firebaseConfig }] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    import('./firebase-config.js'),
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
let sortBy = 'title';

/* ---------------- home ---------------- */
function greetName() { return user?.email === NAAMA_EMAIL ? 'נעמה' : (user?.displayName || '').split(' ')[0]; }
function renderHome() {
  $('#greet').textContent = ('היי ' + (greetName() || '')).trim();
  const filter = $('#q').value.trim();
  const list = [...songs].sort((a, b) => (a[sortBy] || '').localeCompare(b[sortBy] || '', 'he'));
  const shown = filter ? list.filter((s) => (s.title + ' ' + s.performer).includes(filter)) : list;
  $('#rep').innerHTML = shown.map((s) => `<li><button data-id="${esc(s.id)}"><span class="t">${esc(s.title)}</span><span class="p">${esc(s.performer || '')}</span></button></li>`).join('');
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
  cur.opts = { noNiqqud: false, transpose: 0, qrUrl: '', ...(cur.opts || {}) };
  view = { kind: 'choir', print: view.print, layoutPick: cur.opts.layoutPick || 'one', voicing: false };
  $('#song-title-bar').textContent = cur.title || 'שיר';
  $('#opt-niqqud').checked = !!cur.opts.noNiqqud;
  $('#qr-url').value = cur.opts.qrUrl || '';
  $('#edit-box').hidden = true; $('#del-confirm').hidden = true; $('#voices-hint').hidden = true;
  $('#btn-voices').textContent = 'סימון קולות';
  $('#btn-delete').hidden = !cur.id;
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
  const pv = $('#preview');
  pv.classList.toggle('text-only', view.print === 'text');
  pv.classList.toggle('voicing', view.voicing);
  if (!chosen) { pv.innerHTML = '<p class="hint">השיר ארוך מדי גם לשני עמודים. נסי עריכת הטקסט.</p>'; return; }
  pv.innerHTML = pagesHTML(chosen).split('</section>').filter((x) => x.trim()).map((h, i, arr) => `<div class="pv-label">${arr.length > 1 ? 'עמוד ' + (i + 1) + ' · ' : ''}גודל כתב ${chosen.font}</div><div class="pv-wrap">${h}</section></div>`).join('');
  scalePreview();
  $('#print-root').innerHTML = pagesHTML(chosen);
}
function scalePreview() {
  const pv = $('#preview');
  const w = Math.min(pv.clientWidth, 820);
  $$('.pv-wrap').forEach((wrap) => {
    const page = wrap.querySelector('.page');
    const pw = page.offsetWidth, ph = page.offsetHeight;
    const sc = Math.min(1, w / pw);
    page.style.transform = `scale(${sc})`;
    wrap.style.width = pw * sc + 'px'; wrap.style.height = ph * sc + 'px';
  });
}
addEventListener('resize', () => { if (!$('#v-song').hidden) scalePreview(); });

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
  if (existing) { openSong(existing); toast('השיר כבר ברפרטואר'); return; }
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
    window.open('https://shironet.mako.co.il/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
  };
  $('#btn-paste-toggle').onclick = () => { $('#paste-box').hidden = !$('#paste-box').hidden; if (!$('#paste-box').hidden) $('#paste').focus(); };
  $('#btn-paste-go').onclick = () => { const t = $('#paste').value; if (!t.trim()) return; handleImport({ text: t }); $('#paste').value = ''; $('#paste-box').hidden = true; };
  $('#rep').onclick = $('#q-results').onclick = (e) => { const b = e.target.closest('button[data-id]'); if (b) openSong(songs.find((s) => s.id === b.dataset.id)); };
  $$('[data-sort]').forEach((b) => (b.onclick = () => { sortBy = b.dataset.sort; setSeg('[data-sort]', sortBy); renderHome(); }));

  $('#btn-back').onclick = () => { show('v-home'); renderHome(); };
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
