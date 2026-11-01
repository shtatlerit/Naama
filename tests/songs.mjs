// Synthetic test songs (made-up lines, no real lyrics) that reproduce structures met in real songs.
// Each case records a lesson learned; add a new one whenever a real song comes out wrong.
const v = (tag, n = 4) => Array.from({ length: n }, (_, i) => `שורה ${i + 1} של ${tag} כאן`);
const block = (lines) => lines.join('\n');
const song = (head, stanzas) => head + '\n\n' + stanzas.map(block).join('\n\n');
const HEAD = 'שיר לבדיקה\nלהקה לבדיקה\nמילים: כותבת\nלחן: מלחין';

// "אילו ציפורים": two verses open with the same two lines but end differently -> verses, not a chorus.
const shared = ['פתיחה משותפת לשני הבתים', 'עוד שורה משותפת לשניהם'];
export const birds = song(HEAD, [
  [...shared, 'סוף שונה ראשון של הבית', 'סיום ראשון של הבית'],
  v('פזמון'),
  [...shared, 'סוף שונה שני של הבית', 'סיום שני של הבית'],
  v('בית ג'),
  v('פזמון'),
  v('בית ד'),
]);

// "אמן": chorus repeats with one word added in one line -> still a chorus.
const ch = v('פזמון ארוך', 8);
const ch2 = [...ch]; ch2[3] += ' אמן';
export const amen = song(HEAD, [v('בית א'), v('בית ב'), ch, v('בית ג'), v('בית ד'), ch2]);

// "כד הקמח": full chorus once, later "first line..." references.
const kad = v('פזמון קצר');
export const refs = song('שיר\nלהקה\nמילים ולחן: משוררת', [v('בית א'), kad, v('בית ב'), [kad[0] + '...'], v('בית ג'), [kad[0] + '...']]);

// Shironet page leftovers and a bracketed note.
export const junk = song('שיר\nלהקה\nקיימים 2 ביצועים נוספים לשיר זה\nמילים: א\nלחן: ב', [v('בית א'), ['[בית נוסף לזכרו של מישהו]'], v('בית ב')]);

// Two short stanzas -> one column.
export const short = song(HEAD, [v('בית א'), v('בית ב')]);

// mobile Shironet (mshironet): singular "קיים ביצוע נוסף לשיר זה" must be removed too.
export const junkSingular = song('שיר\nלהקה\nמילים: א\nלחן: ב\nקיים ביצוע נוסף לשיר זה', [v('בית א'), v('בית ב')]);

// "נרותי הזעירים" on mobile Shironet: the song starts with its own title, and a site menu stands above it.
// The button must find the header right above the lyrics (not above the first place the title appears).
const menu = 'הכל שירים מילים לשירים אמנים\nאקורדים';
const startsWithTitle = ['כותרת השיר', 'שורה שנייה של הבית', 'שורה שלישית של הבית', 'שורה רביעית של הבית'];
export const titleFirst = {
  url: 'https://mshironet.mako.co.il/artist?type=lyrics&prfid=1&wrkid=2',
  title: 'כותרת השיר - הזמרת - שירונט',
  text: block(startsWithTitle) + '\n\n' + block(v('בית ב')),
  body: menu + '\nכותרת השיר\nהזמרת\nמילים: משורר\nלחן: עממי\nקיים ביצוע נוסף לשיר זה\n\n' + block(startsWithTitle) + '\n\n' + block(v('בית ב')) + '\n\nתגובות',
};
// the same page through the older button (no "body", header cut at the menu)
export const titleFirstOld = { ...titleFirst, body: undefined, head: menu };
