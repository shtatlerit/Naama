// Renders a song onto A4 logo pages and finds the largest font that fits.
// Page geometry (mm) matches the printed logo page: text area from 46mm top, 10mm sides, 16mm bottom.
import { transposeChords, stripNiqqud } from './parse.js';

export const GEOM = { top: 46, side: 10, bottom: 16, qr: 24 };
const MIN_FONT = 12, MAX_FONT = 30;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function creditsLine(song) {
  const c = song.credits || [];
  return c.map((x) => `${esc(x.label)}: ${esc(x.value)}`).join('  |  ');
}

// stanzas to render: expand refs into full chorus when opts.expand;
// when not expanding, a chorus that repeats an earlier one word for word is shortened to its first line + "..."
const key = (s) => s.lines.map((l) => l.t).join('|').replace(/[\u0591-\u05C7.,]/g, '').replace(/\s+/g, ' ');
function prepStanzas(song, opts) {
  const st = song.stanzas.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l })) }));
  const seen = new Set();
  return st.map((s, i) => {
    if (s.type === 'ref' && opts.expand && st[s.of]) return { ...st[s.of], type: 'chorus', repeat: true, srcIndex: i };
    if (s.type === 'chorus' && !opts.expand) {
      const k = key(s);
      if (seen.has(k)) return { type: 'ref', srcIndex: i, lines: [{ ...s.lines[0], t: s.lines[0].t.replace(/[.,]+$/, '') + '...' }] };
      seen.add(k);
    }
    return { ...s, srcIndex: i };
  });
}

function lineHTML(l, si, li, opts) {
  let t = opts.noNiqqud ? stripNiqqud(l.t) : l.t;
  const voice = l.voice ? `<span class="voice">(${esc(l.voice)})</span> ` : '';
  const chords = opts.chords && l.chords ? `<div class="chords" dir="ltr">${esc(transposeChords(l.chords, opts.transpose || 0))}</div>` : '';
  return `<div class="ln" data-s="${si}" data-l="${li}">${chords}<div class="lt">${voice}${esc(t) || '&nbsp;'}</div></div>`;
}

function stanzaHTML(s, opts) {
  const cls = s.type === 'chorus' || s.type === 'ref' ? 'st chorus' : s.type === 'note' ? 'st note' : 'st';
  const label = s.type === 'chorus' ? '<div class="lbl">פזמון</div>' : '';
  const body = s.lines.map((l, li) => lineHTML(l, s.srcIndex, li, opts)).join('');
  return `<div class="${cls}">${label}${body}</div>`;
}

function headHTML(song, opts) {
  return `<header class="sh">
    <h1>${esc(opts.noNiqqud ? stripNiqqud(song.title) : song.title) || 'שיר'}</h1>
    ${song.performer ? `<div class="perf">${esc(song.performer)}</div>` : ''}
    ${(song.credits || []).length ? `<div class="cred">${creditsLine(song)}</div>` : ''}
  </header>`;
}

function pageShell(inner, opts, pageNo) {
  const qr = opts.qrSvg && pageNo === 0 ? `<div class="qr">${opts.qrSvg}</div>` : '';
  const bottom = GEOM.bottom + (opts.qrSvg ? GEOM.qr : 0);
  return `<section class="page${opts.full ? ' full' : ''}">
    <img class="bg" src="img/page-full.jpg" alt="">
    <div class="content" style="top:${GEOM.top}mm;left:${GEOM.side}mm;right:${GEOM.side}mm;bottom:${bottom}mm">${inner}</div>
    ${qr}
  </section>`;
}

function columnsHTML(stanzas, split, opts) {
  if (split == null) return `<div class="cols one"><div class="col">${stanzas.map((s) => stanzaHTML(s, opts)).join('')}</div></div>`;
  const a = stanzas.slice(0, split), b = stanzas.slice(split);
  return `<div class="cols two"><div class="col">${a.map((s) => stanzaHTML(s, opts)).join('')}</div><div class="col">${b.map((s) => stanzaHTML(s, opts)).join('')}</div></div>`;
}

// Measuring stage (offscreen)
let stage;
function getStage() {
  if (!stage) { stage = document.createElement('div'); stage.className = 'measure'; document.body.appendChild(stage); }
  return stage;
}
function fits(html, font) {
  const s = getStage();
  s.innerHTML = html;
  const page = s.firstElementChild;
  page.style.setProperty('--fs', font + 'pt');
  const content = page.querySelector('.content');
  if (content.scrollHeight > content.clientHeight + 1) return false;
  for (const lt of page.querySelectorAll('.lt, .chords')) { if (lt.scrollWidth > lt.clientWidth + 1) return false; }
  return true;
}
function bestFont(html) {
  if (!fits(html, MIN_FONT)) return 0;
  let lo = MIN_FONT, hi = MAX_FONT;
  while (hi - lo > 0.25) { const mid = (lo + hi) / 2; if (fits(html, mid)) lo = mid; else hi = mid; }
  return Math.floor(lo * 2) / 2;
}

// Find best layout for a set of stanzas on one page (with or without header)
function layoutOne(song, stanzas, opts, withHead, pageNo) {
  const head = withHead ? headHTML(song, opts) : '';
  const cands = [{ split: null }];
  for (let k = 1; k < stanzas.length; k++) cands.push({ split: k });
  let best = null;
  for (const c of cands) {
    const html = pageShell(head + columnsHTML(stanzas, c.split, opts), opts, pageNo);
    const f = bestFont(html);
    // a single column wins ties; two columns must give a clearly bigger font
    const score = c.split == null ? f + 0.75 : f;
    if (!best || score > best.score) best = { ...c, font: f, html, score };
  }
  return best;
}

// Public: compute layouts. Returns {pages:[{html,font}], options:[...] } with one-page and (if needed) two-page alternatives
export function computeLayout(song, opts) {
  const tryWith = (expand) => {
    const o = { ...opts, expand };
    const st = prepStanzas(song, o);
    const one = layoutOne(song, st, o, true, 0);
    return { o, st, one };
  };
  let r = tryWith(true);
  const canShorten = song.stanzas.some((s) => s.type === 'ref' || s.type === 'chorus');
  if (canShorten && (!r.one || r.one.font < 16)) { const r2 = tryWith(false); if (r2.one && (!r.one || r2.one.font > r.one.font)) r = r2; }
  const result = { expanded: r.o.expand, onePage: r.one && r.one.font ? { pages: [r.one], font: r.one.font } : null, twoPages: null };
  // offer two pages when one page is cramped
  if (!result.onePage || result.onePage.font < 15) {
    const st = r.st; let bestTwo = null;
    for (let k = 1; k < st.length; k++) {
      const p1 = layoutOne(song, st.slice(0, k), r.o, true, 0), p2 = layoutOne(song, st.slice(k), r.o, false, 1);
      if (!p1 || !p2 || !p1.font || !p2.font) continue;
      const font = Math.min(p1.font, p2.font);
      if (!bestTwo || font > bestTwo.font) bestTwo = { pages: [p1, p2], font };
    }
    // render both pages at the same font size
    if (bestTwo) bestTwo.pages = bestTwo.pages.map((p) => ({ ...p, font: bestTwo.font }));
    result.twoPages = bestTwo;
  }
  if (stage) stage.innerHTML = '';
  return result;
}

export function pagesHTML(layout) {
  return layout.pages.map((p) => p.html.replace('<section class="page', `<section style="--fs:${p.font}pt" class="page`)).join('');
}
