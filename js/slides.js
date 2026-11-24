// Song presentation (מצגת שירים): 16:9 slides on the logo-page style background.
// Cover: Naama's logo, the event title and the date (Hebrew + Gregorian). Songs are numbered
// by their order in the presentation; a long song continues on further slides, never splitting a stanza.
import { bookDates } from './songbook.js?v=20261124-1808';
import { markChoruses, stripNiqqud } from './parse.js?v=20261124-1808';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAX_FONT = 44, MIN_FONT = 16; // pt, on a 320×180 mm slide: projected, it must read from the back of a hall
const ONE_SLIDE_MIN = 32; // a whole song stays on one slide only if it is still this large

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
function songSlide(num, song, stanzas, cont) {
  return `<section class="page slide full"><img class="bg" src="img/slide-bg.jpg" alt="">
    <div class="sl-head"><span class="sl-num">${num}</span><span class="sl-title">${esc(song.title || 'שיר')}</span>${cont ? '<span class="sl-cont">(המשך)</span>' : ''}</div>
    <div class="sl-body">${stanzas.map(stanzaHTML).join('')}</div></section>`;
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

// Largest font at which every stanza fits a slide on its own; then fill slides with whole stanzas.
function slidesForSong(num, song, opts) {
  const st = stanzasOf(song, opts.noNiqqud);
  if (!st.length) return [];
  let fs = MIN_FONT;
  for (let f = MAX_FONT; f >= MIN_FONT; f -= 1) {
    if (st.every((s) => fits(songSlide(num, song, [s], false), f))) { fs = f; break; }
  }
  // if the whole song fits on one slide at a font not much smaller, prefer one slide
  for (let f = fs; f >= Math.max(ONE_SLIDE_MIN, fs - 6); f -= 1) {
    if (fits(songSlide(num, song, st, false), f)) return [{ html: songSlide(num, song, st, false), fs: f }];
  }
  const out = []; let cur = [];
  for (const s of st) {
    const next = [...cur, s];
    if (!cur.length || fits(songSlide(num, song, next, out.length > 0), fs)) cur = next;
    else { out.push(cur); cur = [s]; }
  }
  if (cur.length) out.push(cur);
  return out.map((group, i) => ({ html: songSlide(num, song, group, i > 0), fs }));
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
  const fit = () => {
    const W = innerWidth, H = innerHeight;
    slides.forEach((s) => { const sc = Math.min(W / s.offsetWidth, H / s.offsetHeight); s.style.transform = `translate(-50%,-50%) scale(${sc})`; });
  };
  const go = (n) => { i = Math.max(0, Math.min(slides.length - 1, n)); slides.forEach((s, k) => s.classList.toggle('on', k === i)); ov.querySelector('.pr-n').textContent = `${i + 1} / ${slides.length}`; wake(); };
  const wake = () => { ov.classList.add('bar'); clearTimeout(barTimer); barTimer = setTimeout(() => ov.classList.remove('bar'), 2500); };
  const close = () => { removeEventListener('keydown', key); removeEventListener('resize', fit); if (document.fullscreenElement) document.exitFullscreen?.(); ov.remove(); };
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
  fit(); go(0);
  return { go, close, count: slides.length };
}
