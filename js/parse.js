// Parsing song text (from the Shironet button or a manual paste) into a song model.
// Model: { title, performer, credits:[{label,value}], stanzas:[{type,lines:[{t,chords?,voice?}]}], hasChords, source:{url,prfid,wrkid,type} }
// stanza.type: 'verse' | 'chorus' | 'ref' (short chorus reference "...") | 'note' (e.g. "[בית נוסף לזכרו של...]")

const JUNK = [
  /קיימים\s+\d+\s+ביצועים/, /^מילות השיר$/, /^אקורדים$/, /^chords$/i, /^lyrics$/i,
  /דווח על טעות/, /^\d+\s*תגובות?$/, /^תגובות$/, /הוסף תגובה/, /^עמוד הבית/, /^>/,
  /^שירונט$/, /^הדפס/, /^שלח לחבר/, /^שתף/, /^ראשי$/, /^אמנים$/, /^שירים$/, /^ביוגרפיה$/, /^תמונות$/,
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
  const before = firstCredit >= 0 ? lines.slice(0, firstCredit) : lines;
  let title = '', performer = '';
  if (before.length >= 2) { title = before[before.length - 2]; performer = before[before.length - 1]; }
  else if (before.length === 1) { title = before[0]; }
  if (!title && docTitle) {
    // Shironet tab titles look like "<song> - <artist> - שירונט" or "מילות השיר <song> - <artist>"
    const parts = docTitle.replace(/^(מילות השיר|אקורדים לשיר)\s*/, '').split(/\s+[-–|]\s+/);
    title = parts[0] || ''; performer = performer || parts[1] || '';
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
  // chorus: stanzas whose first two lines repeat elsewhere
  const sig = (s) => norm(s.lines.slice(0, 2).map((l) => l.t).join(' '));
  const counts = {};
  out.forEach((s) => { if (s.type !== 'note' && s.type !== 'ref') counts[sig(s)] = (counts[sig(s)] || 0) + 1; });
  out.forEach((s) => { if (s.type === 'verse' && counts[sig(s)] > 1) s.type = 'chorus'; });
  // a stanza that directly follows a chorus-titled block of "אמן..." style repeated lines stays verse
  return out;
}

export function parseImport(data) {
  // data: {text, head?, title?, url?}  (from the bookmarklet) or {text} from a paste
  const src = sourceFromUrl(data.url || '');
  let text = (data.text || '').replace(/\r/g, '').replace(/ /g, ' ');
  let headLines = (data.head || '').replace(/\r/g, '').split('\n');
  let bodyLines = text.split('\n');

  if (!data.head) {
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
  while (bodyLines.length && (!bodyLines[0].trim() || [head.title, head.performer].includes(bodyLines[0].trim()))) bodyLines.shift();

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
