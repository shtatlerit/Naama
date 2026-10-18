// Save the current song as PDF (exact picture of the preview pages) or Word (editable, on the logo template).
import { transposeChords, stripNiqqud } from './parse.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  return loaded[src];
}
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const safeName = (s) => (s || 'שיר').replace(/[\\/:*?"<>|]+/g, ' ').trim();

/* ---------------- PDF ---------------- */
export async function savePdf(pagesHtml, full, fileBase) {
  await Promise.all([loadScript('js/vendor/html-to-image.js'), loadScript('js/vendor/jspdf.umd.min.js')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-4000px;top:0;';
  host.innerHTML = pagesHtml;
  document.body.appendChild(host);
  try {
    const pages = [...host.querySelectorAll('.page')];
    pages.forEach((p) => { p.style.transform = 'none'; if (!full) p.querySelector('.bg')?.remove(); });
    await Promise.all([...host.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    for (let i = 0; i < pages.length; i++) {
      const opt = { pixelRatio: 2.5, backgroundColor: '#ffffff', skipFonts: true, cacheBust: false };
      // WebKit sometimes paints the first pass blank; a warm-up pass avoids that
      await window.htmlToImage.toJpeg(pages[i], { ...opt, pixelRatio: 0.3 });
      const img = await window.htmlToImage.toJpeg(pages[i], { ...opt, quality: 0.92 });
      if (i) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    }
    download(pdf.output('blob'), safeName(fileBase) + '.pdf');
  } finally { host.remove(); }
}

/* ---------------- Word ---------------- */
const X = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const C = { navy: '26385A', slate: '5F7189', gold: 'B08A5E', teal: '2F7F8A' };
function run(text, { size, bold, italic, color = C.navy, rtl = true }) {
  const sz = Math.round(size * 2);
  return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/><w:bCs/>' : ''}${italic ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${X(text)}</w:t></w:r>`;
}
function para(runs, { after = 0, before = 0, line = 288 } = {}) {
  return `<w:p><w:pPr><w:bidi/><w:spacing w:before="${Math.round(before * 20)}" w:after="${Math.round(after * 20)}" w:line="${line}" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${runs}</w:p>`;
}
function stanzaXml(s, o, fs) {
  let x = '';
  if (s.type === 'chorus') x += para(run('פזמון', { size: 9, bold: true, color: C.gold }), { after: 1 });
  s.lines.forEach((l, i) => {
    const last = i === s.lines.length - 1;
    if (o.chords && l.chords) x += para(run(transposeChords(l.chords, o.transpose || 0), { size: fs * 0.72, bold: true, color: C.teal, rtl: false }), { line: 252 });
    const t = o.noNiqqud ? stripNiqqud(l.t) : l.t;
    const note = s.type === 'note';
    const r = (l.voice ? run(`(${l.voice}) `, { size: fs * 0.62, color: C.slate }) : '') +
      run(t || ' ', note ? { size: 10.5, bold: true, italic: true, color: C.gold } : { size: fs, bold: s.type === 'chorus' || s.type === 'ref' });
    x += para(r, { after: last ? fs * 0.85 : 0 });
  });
  return x;
}
function headXml(song, o) {
  let x = para(run(o.noNiqqud ? stripNiqqud(song.title) : song.title || 'שיר', { size: 30, bold: true }), { line: 264 });
  if (song.performer) x += para(run(song.performer, { size: 14, color: C.slate }), { before: 2 });
  if (song.credits?.length) x += para(run(song.credits.map((c) => `${c.label}: ${c.value}`).join('  |  '), { size: 10, color: C.slate }), { before: 2 });
  return x + para('', { after: 10 });
}
function colsXml(stanzas, split, o, fs) {
  const body = (arr) => arr.map((s) => stanzaXml(s, o, fs)).join('') || para('');
  if (split == null) return body(stanzas);
  const W = 5386;
  const cell = (arr) => `<w:tc><w:tcPr><w:tcW w:w="${W}" w:type="dxa"/></w:tcPr>${body(arr)}</w:tc>`;
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${W * 2}" w:type="dxa"/><w:tblLayout w:type="fixed"/>
    <w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="C9A57C"/></w:tblBorders>
    <w:tblCellMar><w:left w:w="113" w:type="dxa"/><w:right w:w="113" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid><w:gridCol w:w="${W}"/><w:gridCol w:w="${W}"/></w:tblGrid>
    <w:tr>${cell(stanzas.slice(0, split))}${cell(stanzas.slice(split))}</w:tr></w:tbl>${para('')}`;
}
export async function saveWord(song, layout, full, fileBase) {
  await loadScript('js/vendor/jszip.min.js');
  const tpl = await (await fetch(full ? 'word/template-full.docx' : 'word/template-plain.docx')).arrayBuffer();
  const zip = await window.JSZip.loadAsync(tpl);
  const fs = Math.max(11, layout.font * 0.96); // Word sets lines a touch looser than the browser
  const parts = layout.pages.map((p, i) => {
    const o = p.opts || {};
    return (p.withHead ? headXml(song, o) : '') + colsXml(p.st, p.split, o, fs) + (i < layout.pages.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '');
  }).join('');
  let doc = await zip.file('word/document.xml').async('string');
  doc = doc.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${parts}$1`);
  zip.file('word/document.xml', doc);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  download(blob, safeName(fileBase) + '.docx');
}
