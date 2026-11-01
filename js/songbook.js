// Songbook: a cover (logo page with a stronger watermark), a table of contents and the chosen songs,
// in the order Naama sets, with page numbers. Two short songs may share a page.
import { computeLayout } from './layout.js?v=20261101-2004';
import { markChoruses } from './parse.js?v=20261101-2004';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- dates: Hebrew date in letters + Gregorian ---------- */
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
export function gematria(n) {
  n = n % 1000;
  let s = HUNDREDS[Math.floor(n / 100)];
  const r = n % 100;
  if (r === 15) s += 'טו'; else if (r === 16) s += 'טז'; else s += TENS[Math.floor(r / 10)] + ONES[r % 10];
  return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
}
export function bookDates(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const hebrew = `${gematria(+get('day'))} ב${get('month')} ${gematria(+get('year'))}`;
  const greg = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return { hebrew, greg };
}

/* ---------- page pieces ---------- */
const HALF = { top: { top: 46, bottom: 137.5 }, bottom: { top: 167.5, bottom: 16 }, line: 163.5 };
const bg = (full, img = 'page-full.jpg') => (full ? `<img class="bg" src="img/${img}" alt="">` : '');
const pgno = (n) => `<div class="pgno">– ${n} –</div>`;

function contentOf(p) {
  // a laid-out page → its content block, carrying its own font size and spacing
  const doc = new DOMParser().parseFromString(p.html, 'text/html');
  const c = doc.querySelector('.content');
  c.style.setProperty('--fs', p.font + 'pt');
  c.style.setProperty('--air', p.air || 0);
  return c.outerHTML;
}

function songOpts(song, book) {
  const chords = book.version === 'chords' && !!song.hasChords;
  return { chords, transpose: chords ? song.opts?.transpose || 0 : 0, noNiqqud: !!song.opts?.noNiqqud, full: book.full, qrSvg: '' };
}
function wholeLayout(song, book) {
  const L = computeLayout(song, songOpts(song, book));
  const one = L.onePage, two = L.twoPages;
  if (one && two) return song.opts?.layoutPick === 'two' ? two : one;
  return one || two;
}
function halfLayout(song, book, where) {
  const L = computeLayout(song, { ...songOpts(song, book), box: HALF[where], compactHead: true });
  return L.onePage && L.onePage.pages[0];
}

export const MIN_PAIR_FONT = 16;

// book: {title, date, songIds, toc, pair, version: 'choir'|'chords', full, copies}
export async function buildBook(book, allSongs, progress = () => {}) {
  const byId = new Map(allSongs.map((s) => [s.id, s]));
  const list = (book.songIds || []).map((id) => byId.get(id)).filter(Boolean);
  list.forEach((s) => s.stanzas && markChoruses(s.stanzas));
  const pages = []; // {html} song pages, numbered from 1
  const toc = [];
  const skipped = [];
  const tick = () => new Promise((r) => setTimeout(r, 0));

  let i = 0;
  while (i < list.length) {
    progress(i, list.length); await tick();
    const a = list[i], b = list[i + 1];
    if (book.pair && b) {
      const ha = halfLayout(a, book, 'top');
      const hb = ha && ha.font >= MIN_PAIR_FONT ? halfLayout(b, book, 'bottom') : null;
      if (ha && hb && hb.font >= MIN_PAIR_FONT) {
        const n = pages.length + 1;
        toc.push({ title: a.title, performer: a.performer, page: n }, { title: b.title, performer: b.performer, page: n });
        pages.push(`<section class="page${book.full ? ' full' : ''}">${bg(book.full)}${contentOf(ha)}<div class="split" style="top:${HALF.line}mm"></div>${contentOf(hb)}${pgno(n)}</section>`);
        i += 2; continue;
      }
    }
    const L = wholeLayout(a, book);
    if (!L) { skipped.push(a.title); i++; continue; }
    toc.push({ title: a.title, performer: a.performer, page: pages.length + 1 });
    for (const p of L.pages) {
      const n = pages.length + 1;
      pages.push(`<section class="page${book.full ? ' full' : ''}">${bg(book.full)}${contentOf({ ...p, font: L.font ?? p.font })}${pgno(n)}</section>`);
    }
    i++;
  }
  progress(list.length, list.length);

  const d = bookDates(book.date);
  const cover = `<section class="page${book.full ? ' full' : ''}">${bg(book.full, 'cover.jpg')}
    <div class="cover"><h1>${esc(book.title || 'שירון')}</h1>
    ${book.version === 'chords' ? '<div class="sub">גרסת אקורדים</div>' : ''}
    ${d ? `<div class="date">${esc(d.hebrew)}  ·  ${esc(d.greg)}</div>` : ''}</div></section>`;

  let tocPage = '';
  if (book.toc && toc.length) {
    const fs = toc.length <= 18 ? 15 : Math.max(9, (15 * 18) / toc.length);
    tocPage = `<section class="page${book.full ? ' full' : ''}">${bg(book.full)}
      <div class="content toc" style="top:46mm;left:10mm;right:10mm;bottom:16mm;--tfs:${fs.toFixed(1)}pt">
      <h2>תוכן עניינים</h2><ol>${toc.map((t) => `<li><span class="tt">${esc(t.title)}</span>${t.performer ? `<span class="tp">${esc(t.performer)}</span>` : ''}<span class="dots"></span><span class="tn">${t.page}</span></li>`).join('')}</ol></div></section>`;
  }
  const one = cover + tocPage + pages.join('');
  const copies = Math.max(1, Math.min(20, +book.copies || 1));
  return { html: one.repeat(copies), pageCount: (1 + (tocPage ? 1 : 0) + pages.length) * copies, songPages: pages.length, skipped };
}
