// Run: node tests/parse.test.mjs
import { parseImport, markChoruses } from '../js/parse.js';
import * as S from './songs.mjs';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const types = (t) => parseImport({ text: t }).stanzas.map((s) => s.type);

ok(JSON.stringify(types(S.birds)) === JSON.stringify(['verse', 'chorus', 'verse', 'verse', 'chorus', 'verse']),
  'verses that only share opening lines are not a chorus (אילו ציפורים) ' + types(S.birds));
ok(types(S.amen).filter((x) => x === 'chorus').length === 2, 'chorus with a small change is still a chorus (אמן)');
const r = parseImport({ text: S.refs });
ok(r.stanzas.filter((s) => s.type === 'ref').length === 2 && r.stanzas[1].type === 'chorus', '"first line..." becomes a reference to the full chorus (כד הקמח)');
ok(r.credits.length === 1 && r.credits[0].label === 'מילים ולחן', 'credits "מילים ולחן" read');
const j = parseImport({ text: S.junk });
ok(!JSON.stringify(j).includes('ביצועים נוספים'), 'Shironet leftovers removed');
ok(!JSON.stringify(parseImport({ text: S.junkSingular })).includes('ביצוע נוסף'), 'Shironet leftover in singular removed (mshironet)');
ok(j.stanzas.some((s) => s.type === 'note'), 'bracketed line becomes a note');
ok(j.title === 'שיר' && j.performer === 'להקה', 'title and performer read');

const tf = parseImport(S.titleFirst);
ok(tf.title === 'כותרת השיר' && tf.performer === 'הזמרת', 'song that starts with its title: title and performer read (נרותי הזעירים) ' + tf.title + ' / ' + tf.performer);
ok(tf.credits.length === 2, 'song that starts with its title: credits read');
ok(tf.stanzas[0].lines[0].t === 'כותרת השיר', 'first lyric line equal to the title is kept');
ok(!JSON.stringify(tf).includes('אמנים'), 'site menu does not get into the song');
const old1 = parseImport(S.titleFirstOld);
ok(old1.title === 'כותרת השיר' && old1.performer === 'הזמרת', 'older button: names taken from the tab title when the header is a menu ' + old1.title);

// Songs saved before a rule changed are corrected when opened
const old = parseImport({ text: S.birds }).stanzas; old.forEach((s) => (s.type = 'chorus'));
ok(markChoruses(old)[0].type === 'verse', 'old saved songs are re-checked on open');

console.log(fail ? `\n${fail} FAILED` : '\nall parse tests passed');
process.exit(fail ? 1 : 0);
