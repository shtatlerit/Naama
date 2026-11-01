// Parsing song text (from the Shironet button or a manual paste) into a song model.
// Model: { title, performer, credits:[{label,value}], stanzas:[{type,lines:[{t,chords?,voice?}]}], hasChords, source:{url,prfid,wrkid,type} }
// stanza.type: 'verse' | 'chorus' | 'ref' (short chorus reference "...") | 'note' (e.g. "[בית נוסף לזכרו של...]")

const JUNK = [
  /קיימ(?:ים|ת|ות)?\s+(?:\d+\s+)?ביצוע(?:ים)?\s+נוספ/, /^קיים ביצוע/, /^מילות השיר$/, /^אקורדים$/, /^chords$/i, /^lyrics$/i,
  /דווח על טעות/, /^\d+\s*תגובות?$/, /^תגובות$/, /הוסף תגובה/, /^עמוד הבית/, /^>/,
  /^שירונט$/, /^(?:הכל|שירים|אמנים|מילים לשירים|אקורדים|דף הבית|חיפוש)(?:\s+(?:הכל|שירים|אמנים|מילים לשירים|אקורדים|דף הבית|חיפוש))+$/, /^הדפס/, /^שלח לחבר/, /^שתף/, /^ראשי$/, /^אמנים$/, /^שירים$/, /^ביוגרפיה$/, /^תמונות$/,
];
const CREDIT = /^(מילים ולחן|מילים ולחן ועיבוד|מילים|לחן|עיבוד|תרגום|נוסח עברי|לחן עממי)\s*[:：]\s*(.+)$/;
const CHORD_TOKEN = /^[A-H](#|b)?(m|maj|min|dim|aug|sus|add|M)?\d*(sus\d*|add\d*|maj\d*|b\d+|#\d+)*(\/[A-H](#|b)?)?$/;

export function stripMdLinks(s) { return s.replace(/\[([^\]]*)\]\((?:https?:)?[^)]*\)/g, '$1'); }
export function stripNiqqud(s) { return s.replace(/[֑-ׇֽֿׁׂׅׄ]/g, ''); }
export const isJunk = (l) => JUNK.some((r) => r.test(l.trim()));

export function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  return toks.every((t) => CHORD_TOKEN.test(t.replace(/[()|]/g, '')) || /^[|\-x\d]+$/.test(t));
}

// Shironet ids from a URL
export function sourceFromUrl(url) {
  try {
    const u = new URL(url);
    return { url, prfid: u.searchParams.get('prfid') || '', wrkid: u.searchParams.get('wrkid') || '', type: u.searchParams.get('type') || '' };
  } catch { return { url: url || '', prfid: '', wrkid: '', type: '' }; }
}

// Header: title, performer, credits from the text above the lyrics
function parseHead(headLines, docTitle) {
  const lines = headLines.map((l) => stripMdLinks(l).trim()).filter((l) => l && !isJunk(l));
  const credits = [];
  let firstCredit = -1;
  lines.forEach((l, i) => {
    const m = l.match(CREDIT);
    if (m) { credits.push({ label: m[1], value: m[2].trim() }); if (firstCredit < 0) firstCredit = i; }
  });
  let title = '', performer = '';
  if (firstCredit >= 0) {
    // the song's title and performer are the two lines right above the credits
    const before = lines.slice(0, firstCredit);
    if (before.length >= 2) { title = before[before.length - 2]; performer = before[before.length - 1]; }
    else if (before.length === 1) { title = before[0]; }
  }
  if (!title && docTitle) {
    // No credits found means the text above the lyrics is not the song header (e.g. a site menu):
    // take the names from the tab title, e.g. "<song> - <artist> - שירונט" or "מילות השיר <song> - <artist>"
    const parts = docTitle.replace(/^(מילות השיר|אקורדים לשיר|אקורדים)\s*/, '').split(/\s+[-–|]\s+/)
      .map((x) => x.trim()).filter((x) => x && !/שירונט|mako|מילים לשיר|^אקורדים/.test(x));
    title = parts[0] || ''; performer = parts[1] || '';
  }
  if (!title && lines.length) {
    // last resort (pasted text without credits): first lines
    title = lines[0]; performer = lines[1] || '';
  }
  return { title, performer, credits };
}

function toStanzas(bodyLines) {
  const stanzas = [];
  let cur = [];
  const flush = () => { if (cur.length) { stanzas.push(cur); cur = []; } };
  for (const raw of bodyLines) {
    const l = raw.replace(/\s+$/, '');
    if (!l.trim()) { flush(); continue; }
    if (isJunk(l)) continue;
    cur.push(l);
  }
  flush();
  return stanzas;
}

const norm = (s) => s.replace(/[֑-ׇ]/g, '').replace(/[.,!?;:"'״׳…\-–]/g, '').replace(/\s+/g, ' ').trim();

// chorus: a stanza repeated elsewhere almost word for word (at least 3/4 of its lines match).
// Verses that only share an opening line (e.g. "אילו ציפורים...") stay verses.
// Also used on songs saved before this rule, so old repertoire entries are corrected when opened.
export function markChoruses(out) {
  const lineSet = (s) => s.lines.map((l) => norm(l.t)).filter(Boolean);
  const same = (a, b) => {
    const A = lineSet(a), B = lineSet(b);
    if (A.length < 2 || B.length < 2) return false;
    const n = Math.max(A.length, B.length);
    let hit = 0; A.forEach((x, i) => { if (x === B[i]) hit++; });
    return hit / n >= 0.75;
  };
  const refd = new Set(out.filter((s) => s.type === 'ref').map((s) => s.of));
  out.forEach((s, i) => {
    if (s.type !== 'verse' && s.type !== 'chorus') return;
    const rep = refd.has(i) || out.some((o, j) => j !== i && (o.type === 'verse' || o.type === 'chorus') && same(s, o));
    s.type = rep ? 'chorus' : 'verse';
  });
  return out;
}

// Build model stanzas, attach chords, detect chorus/ref/note
function classify(rawStanzas) {
  const out = rawStanzas.map((ls) => {
    const lines = [];
    let pendingChords = null;
    for (const l of ls) {
      if (isChordLine(l)) { pendingChords = (pendingChords ? pendingChords + '  ' : '') + l.trim(); continue; }
      lines.push(pendingChords ? { t: l.trim(), chords: pendingChords } : { t: l.trim() });
      pendingChords = null;
    }
    if (pendingChords) lines.push({ t: '', chords: pendingChords });
    return { type: 'verse', lines };
  }).filter((s) => s.lines.length);

  // note: a single bracketed line
  out.forEach((s) => {
    if (s.lines.length === 1 && /^\[.*\]$/.test(s.lines[0].t)) { s.type = 'note'; s.lines[0].t = s.lines[0].t.slice(1, -1).trim(); }
  });
  // ref: a short line ending with "..." whose start matches the first line of a longer stanza
  out.forEach((s) => {
    if (s.type !== 'verse' || s.lines.length > 2) return;
    const t = s.lines[s.lines.length - 1].t;
    const dotted = /(\.\.\.|…)\s*$/.test(t);
    if (!dotted && s.lines.length !== 1) return;
    const key = norm(s.lines[0].t);
    if (!dotted && key.length < 6) return;
    const target = out.find((o) => o !== s && o.lines.length > s.lines.length && norm(o.lines[0].t).startsWith(key.slice(0, Math.max(6, key.length - 2))));
    if (target) { s.type = 'ref'; s.of = out.indexOf(target); if (target.type === 'verse') target.type = 'chorus'; }
  });
  markChoruses(out);
  // a stanza that directly follows a chorus-titled block of "אמן..." style repeated lines stays verse
  return out;
}

export function parseImport(data) {
  // data: {text, head?, title?, url?}  (from the bookmarklet) or {text} from a paste
  const src = sourceFromUrl(data.url || '');
  let text = (data.text || '').replace(/\r/g, '').replace(/ /g, ' ');
  let headText = data.head || '';
  if (data.body && text.trim()) {
    // Newer button sends the whole page text: the header is what stands right above the lyrics block.
    // Match several lyric lines, since a song often starts with its own title.
    const body = data.body.replace(/\r/g, '').replace(/\u00a0/g, ' ');
    const first = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let at = -1;
    for (let n = Math.min(3, first.length); n >= 1 && at < 0; n--) {
      const re = new RegExp(first.slice(0, n).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*\\n\\s*'));
      const m = re.exec(body); if (m) at = m.index;
    }
    if (at > 0) headText = body.slice(Math.max(0, at - 1500), at);
  }
  let headLines = headText.replace(/\r/g, '').split('\n');
  let bodyLines = text.split('\n');

  if (!headText) {
    // pasted text: header = lines up to and including the credits block (stop at first blank line after any credit or after 4 lines)
    const lines = bodyLines;
    let i = 0, seenCredit = false, headEnd = -1;
    for (; i < Math.min(lines.length, 14); i++) {
      const l = stripMdLinks(lines[i]).trim();
      if (CREDIT.test(l)) seenCredit = true;
      if (!l && seenCredit) { headEnd = i; break; }
    }
    if (headEnd < 0 && seenCredit) {
      // credits without a blank after them: header ends at last credit/junk line
      let last = 0;
      for (let j = 0; j < Math.min(lines.length, 14); j++) { const l = stripMdLinks(lines[j]).trim(); if (CREDIT.test(l) || isJunk(l)) last = j; }
      headEnd = last + 1;
    }
    if (headEnd > 0) { headLines = lines.slice(0, headEnd); bodyLines = lines.slice(headEnd); }
    else headLines = [];
  }
  const head = parseHead(headLines, data.title || '');
  bodyLines = bodyLines.map((l) => stripMdLinks(l)).filter((l) => !CREDIT.test(l.trim()));
  // drop leading lines that repeat the title/performer (some pages repeat them inside the lyrics box)
  // (only as a pair: a song that simply starts with its own title keeps that line)
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  if (head.performer && bodyLines.length > 1 && bodyLines[0].trim() === head.title && bodyLines[1].trim() === head.performer) bodyLines.splice(0, 2);

  const stanzas = classify(toStanzas(bodyLines));
  const hasChords = stanzas.some((s) => s.lines.some((l) => l.chords));
  return { ...head, stanzas, hasChords, source: src };
}

// Merge chords from a chords-page import into an existing song (same lyric lines)
export function mergeChords(song, chordSong) {
  const flat = chordSong.stanzas.flatMap((s) => s.lines).filter((l) => l.chords);
  const byText = new Map(flat.map((l) => [norm(l.t), l.chords]));
  song.stanzas.forEach((s) => s.lines.forEach((l) => { const c = byText.get(norm(l.t)); if (c) l.chords = c; }));
  song.hasChords = song.stanzas.some((s) => s.lines.some((l) => l.chords));
  return song;
}

// Plain-text round trip for the optional editor
export function toText(song) {
  return song.stanzas.map((s) => {
    const body = s.lines.map((l) => (l.chords ? l.chords + '\n' : '') + l.t).join('\n');
    return s.type === 'note' ? '[' + body + ']' : body;
  }).join('\n\n');
}
export function fromText(song, text) {
  const fresh = parseImport({ text, head: ' ' });
  // keep voices by line text
  const voices = new Map(song.stanzas.flatMap((s) => s.lines).filter((l) => l.voice).map((l) => [norm(l.t), l.voice]));
  fresh.stanzas.forEach((s) => s.lines.forEach((l) => { const v = voices.get(norm(l.t)); if (v) l.voice = v; }));
  return { ...song, stanzas: fresh.stanzas, hasChords: fresh.hasChords };
}

// Chord transposition
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NICE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function shiftNote(n, k, preferFlat) {
  let i = SHARPS.indexOf(n); if (i < 0) i = FLATS.indexOf(n); if (i < 0) return n;
  const j = (i + k + 120) % 12;
  return (preferFlat === 'b' ? FLATS : preferFlat === '#' ? SHARPS : NICE)[j];
}
export function transposeChords(line, k) {
  if (!k) return line;
  return line.replace(/([A-G])(#|b)?/g, (m, r, acc) => shiftNote(r + (acc || ''), k, acc || ''));
}
