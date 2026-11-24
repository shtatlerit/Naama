// Song presentation (מצגת שירים): 16:9 slides on the logo-page style background.
// Cover: Naama's logo, the event title and the date (Hebrew + Gregorian). Songs are numbered
// by their order in the presentation; a long song continues on further slides, never splitting a stanza.
import { bookDates } from './songbook.js?v=20261124-1845';
import { markChoruses, stripNiqqud } from './parse.js?v=20261124-1845';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAX_FONT = 34, MIN_FONT = 14; // pt, on a 320×180 mm slide. A whole song goes on one slide (it is projected large)
const TINTS = 5; // img/slide-bg-1..5.jpg: soft hues that change from song to song

// full choruses instead of "first line..." references: on a screen everyone sings from the slide
function stanzasOf(song, noNiqqud) {
  const st = (song.stanzas || []).map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) }));
  markChoruses(st);
  return st.map((s) => (s.type === 'ref' && st[s.of] ? { ...st[s.of], type: 'chorus' } : s))
    .map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, t: noNiqqud ? stripNiqqud(l.t) : l.t })) }));
}

function stanzaHTML(s) {
  const cls = s.type === 'chorus' ? 'st chorus' : s.type === 'note' ? 'st note' : 'st';
  const lbl = s.type === 'chorus' ? '<div class="lbl">פזמון</div>' : '';
  return `<div class="${cls}">${lbl}${s.lines.map((l) => `<div class="lt">${esc(l.t) || '&nbsp;'}</div>`).join('')}</div>`;
}
function songSlide(num, song, stanzas, cont, split = null) {
  const tint = ((num - 1) % TINTS) + 1;
  const body = split == null ? stanzas.map(stanzaHTML).join('')
    : `<div class="sl-row"><div class="sl-col">${stanzas.slice(0, split).map(stanzaHTML).join('')}</div><div class="sl-col">${stanzas.slice(split).map(stanzaHTML).join('')}</div></div>`;
  return `<section class="page slide full"><img class="bg" src="img/slide-bg-${tint}.jpg" alt="">
    <div class="sl-head"><span class="sl-num">${num}</span><span class="sl-title">${esc(song.title || 'שיר')}</span>${cont ? '<span class="sl-cont">(המשך)</span>' : ''}</div>
    <div class="sl-body${split == null ? '' : ' two'}">${body}</div></section>`;
}

let stage;
function fits(html, fs) {
  if (!stage) { stage = document.createElement('div'); stage.className = 'measure'; document.body.appendChild(stage); }
  stage.innerHTML = html;
  const sl = stage.firstElementChild; sl.style.setProperty('--sfs', fs + 'pt');
  const body = sl.querySelector('.sl-body');
  if (body.scrollHeight > body.clientHeight + 1) return false;
  return ![...sl.querySelectorAll('.lt')].some((l) => l.scrollWidth > l.clientWidth + 1);
}

function bestFont(html) {
  if (!fits(html, MIN_FONT)) return 0;
  let lo = MIN_FONT, hi = MAX_FONT;
  if (fits(html, hi)) return hi;
  while (hi - lo > 0.25) { const m = (lo + hi) / 2; if (fits(html, m)) lo = m; else hi = m; }
  return Math.floor(lo * 2) / 2;
}
const rows = (arr) => arr.reduce((n, s) => n + s.lines.length + 1, 0);
// Two columns: the right column (read first) gets the first stanzas. Only near-balanced splits,
// with the right column the same or longer, so a lone stanza never floats beside a full column.
function splits(st) {
  // (with an odd number of stanzas one column is longer by about a stanza: that one is the right column)
  const total = rows(st), out = [], biggest = Math.max(...st.map((x) => x.lines.length + 1));
  for (let k = 1; k < st.length; k++) {
    const r = rows(st.slice(0, k)), l = total - r;
    if (r >= l && r - l <= Math.max(3, biggest)) out.push(k);
  }
  return out;
}
// best font for one group of stanzas in a given mode ('one' | 'two'); returns {fs, split}
function fitGroup(num, song, st, cont, mode) {
  if (mode === 'one') return { fs: bestFont(songSlide(num, song, st, cont)), split: null };
  let best = { fs: 0, split: null };
  for (const k of splits(st)) { const fs = bestFont(songSlide(num, song, st, cont, k)); if (fs > best.fs) best = { fs, split: k }; }
  return best;
}
// whole stanzas into consecutive slides, each fitting at font f in the mode
function pack(num, song, st, mode, f) {
  const out = []; let cur = [];
  const ok = (g, cont) => (mode === 'one' ? fits(songSlide(num, song, g, cont), f) : splits(g).some((k) => fits(songSlide(num, song, g, cont, k), f)) || (g.length === 1 && fits(songSlide(num, song, g, cont), f)));
  for (const s of st) {
    const next = [...cur, s];
    if (!cur.length || ok(next, out.length > 0)) cur = next;
    else { out.push(cur); cur = [s]; }
  }
  if (cur.length) out.push(cur);
  return out;
}
function slidesForSong(num, song, opts) {
  const st = stanzasOf(song, opts.noNiqqud);
  if (!st.length) return [];
  // the whole song on one slide, one column or two (two only when the font is clearly larger)
  const one = fitGroup(num, song, st, false, 'one'), two = fitGroup(num, song, st, false, 'two');
  const pick = two.fs > one.fs + 2 ? two : one;
  if (pick.fs) return [{ html: songSlide(num, song, st, false, pick.split), fs: pick.fs }];
  // A very long song: the fewest slides, and every slide of the song looks the same –
  // same mode (columns) and the same font size, the largest that keeps that number of slides.
  let best = null;
  for (const mode of ['two', 'one']) {
    const n = pack(num, song, st, mode, MIN_FONT).length;
    let lo = MIN_FONT, hi = MAX_FONT;
    while (hi - lo > 0.25) { const m = (lo + hi) / 2; if (pack(num, song, st, mode, m).length <= n) lo = m; else hi = m; }
    const f = Math.floor(lo * 2) / 2;
    if (!best || n < best.n || (n === best.n && f > best.f + (mode === 'one' ? 2 : 0))) best = { mode, n, f };
  }
  const groups = pack(num, song, st, best.mode, best.f);
  return groups.map((g, i) => {
    let split = null;
    if (best.mode === 'two' && g.length > 1) split = splits(g).find((k) => fits(songSlide(num, song, g, i > 0, k), best.f)) ?? null;
    return { html: songSlide(num, song, g, i > 0, split), fs: best.f };
  });
}

export function coverSlide(show) {
  const d = bookDates(show.date);
  return `<section class="page slide full"><img class="bg" src="img/slide-cover.jpg" alt="">
    <div class="sl-cover">${show.title ? `<h1>${esc(show.title)}</h1>` : ''}
    ${d ? `<div class="sl-date">${esc(d.hebrew)}<span class="dot"></span>${esc(d.greg)}</div>` : ''}</div></section>`;
}

// show: {title, date, songIds, noNiqqud}
export async function buildSlides(show, allSongs, progress = () => {}) {
  const byId = new Map(allSongs.map((s) => [s.id, s]));
  const list = (show.songIds || []).map((id) => byId.get(id)).filter(Boolean);
  const slides = [coverSlide(show)];
  for (let i = 0; i < list.length; i++) {
    progress(i, list.length); await new Promise((r) => setTimeout(r, 0));
    for (const s of slidesForSong(i + 1, list[i], show)) slides.push(s.html.replace('<section class="page slide full">', `<section class="page slide full" style="--sfs:${s.fs}pt">`));
  }
  progress(list.length, list.length);
  if (stage) stage.innerHTML = '';
  return { html: slides.join(''), count: slides.length, songs: list.length };
}

/* ---------- presenting: full screen, keyboard / tap / swipe ---------- */
export function present(html) {
  const ov = document.createElement('div');
  ov.className = 'presenter';
  ov.innerHTML = `<div class="pr-stage">${html}</div><div class="pr-bar"><button data-pr="prev" aria-label="הקודם">‹</button><span class="pr-n"></span><button data-pr="next" aria-label="הבא">›</button><button data-pr="close" aria-label="סגירה">✕</button></div>`;
  document.body.appendChild(ov);
  const slides = [...ov.querySelectorAll('.slide')];
  let i = 0, barTimer;
  // Hidden slides have no size (display:none), so the scale is measured on the slide being shown
  // and every slide gets it again whenever it comes on screen (and on resize / full screen).
  const fit = () => {
    const s = slides[i]; if (!s) return;
    const w = s.offsetWidth, h = s.offsetHeight; if (!w || !h) return;
    const sc = Math.min(innerWidth / w, innerHeight / h);
    slides.forEach((x) => { x.style.transform = `translate(-50%,-50%) scale(${sc})`; });
  };
  const go = (n) => { i = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach((s, k) => s.classList.toggle('on', k === i)); fit(); ov.querySelector('.pr-n').textContent = `${i + 1} / ${slides.length}`; wake(); };
  const wake = () => { ov.classList.add('bar'); clearTimeout(barTimer); barTimer = setTimeout(() => ov.classList.remove('bar'), 2500); };
  const close = () => { removeEventListener('keydown', key); removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); if (document.fullscreenElement) document.exitFullscreen?.(); ov.remove(); };
  // Hebrew reads right to left: the next slide is to the left
  const key = (e) => {
    if ([' ', 'PageDown', 'ArrowDown', 'ArrowLeft', 'Enter'].includes(e.key)) { e.preventDefault(); go(i + 1); }
    else if (['PageUp', 'ArrowUp', 'ArrowRight', 'Backspace'].includes(e.key)) { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1);
    else if (e.key === 'Escape') close();
  };
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pr]');
    if (b) { const a = b.dataset.pr; if (a === 'close') close(); else go(i + (a === 'next' ? 1 : -1)); return; }
    go(e.clientX < innerWidth / 2 ? i + 1 : i - 1);
  });
  let x0 = null;
  ov.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  ov.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { e.preventDefault(); go(i + (dx > 0 ? 1 : -1)); } x0 = null; });
  ov.addEventListener('mousemove', wake);
  addEventListener('keydown', key); addEventListener('resize', fit);
  ov.requestFullscreen?.().catch(() => {});
  go(0);
  document.addEventListener('fullscreenchange', fit);
  return { go, close, count: slides.length };
}
