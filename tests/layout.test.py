# Run from the repo root:  python3 -m http.server 8765 &  then  python3 tests/layout.test.py
# Opens the app in dev mode (no login, no Firebase) and checks the page layout rules.
import json, re, subprocess, urllib.parse
from playwright.sync_api import sync_playwright

songs = json.loads(subprocess.check_output(['node', '-e',
  "import('./tests/songs.mjs').then(m=>console.log(JSON.stringify(m)))"], text=True))
fail = 0
def ok(c, m):
    global fail
    print(('PASS ' if c else 'FAIL ') + m); fail += 0 if c else 1

with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1200, 'height': 1700})
    def load(text):
        pg.goto('about:blank')
        pg.goto('http://localhost:8765/?dev#import=' + urllib.parse.quote(json.dumps({'text': text})))
        pg.wait_for_selector('.pv-label', timeout=20000); pg.wait_for_timeout(600)
        return pg.evaluate("""() => {
          const p = document.querySelector('.pv-wrap .page'), c = p.querySelector('.content');
          const cols = [...p.querySelectorAll('.col')].map(x => x.querySelectorAll('.ln').length);
          const heights = [...p.querySelectorAll('.col')].map(x => x.scrollHeight);
          const wrapped = [...p.querySelectorAll('.lt')].some(l => l.scrollWidth > l.clientWidth + 1);
          return { cols, heights, wrapped, overflow: c.scrollHeight > c.clientHeight + 1,
                   fill: c.scrollHeight / c.clientHeight, air: +getComputedStyle(p).getPropertyValue('--air') || 0,
                   label: document.querySelector('.pv-label').textContent }
        }""")
    r = load(songs['birds'])
    ok(len(r['cols']) == 2 and abs(r['cols'][0] - r['cols'][1]) <= 4, f"two columns are balanced {r['cols']}")
    for name in ('birds', 'amen', 'refs', 'junk', 'short'):
        r = load(songs[name])
        ok(not r['wrapped'] and not r['overflow'], f'{name}: no broken lines, fits the page ({r["label"]})')
        ok(r['fill'] > 0.6 or r['air'] >= 1, f"{name}: uses the page height (fill {r['fill']:.2f}, air {r['air']})")
    r = load(songs['short'])
    ok(len(r['cols']) == 1, 'short song uses one column')
    # songbook: cover, table of contents, numbered pages, chosen order
    for i, k in enumerate(['short', 'birds', 'refs']):
        load(songs[k].replace('שיר לבדיקה', 'שיר ' + str(i + 1)) if k != 'refs' else songs[k]); pg.wait_for_timeout(900)  # let it save
    pg.click('#btn-back'); pg.click('#btn-book'); pg.wait_for_timeout(400)
    pg.fill('#bk-date', '2026-12-06'); pg.dispatch_event('#bk-date', 'change')
    for i in range(len(pg.query_selector_all('#bk-pick [data-add]'))): pg.click(f'#bk-pick li:nth-child({i+1}) [data-add]')
    ok('כ״ו בכסלו תשפ״ז' in pg.inner_text('#bk-date-he'), 'songbook: Hebrew date in letters')
    pg.click('#bk-build'); pg.wait_for_selector('#bk-status:has-text("מוכן")', timeout=120000)
    info = pg.evaluate("""() => { const p = [...document.querySelectorAll('#bk-preview .page')];
      return { n: p.length, cover: !!p[0].querySelector('.cover'), toc: !!p[1].querySelector('.toc'),
               nums: p.slice(2).map(x => (x.querySelector('.pgno')?.textContent || '').replace(/[^0-9]/g, '')),
               tocNums: [...p[1].querySelectorAll('.tn')].map(x => x.textContent),
               over: p.some(x => [...x.querySelectorAll('.content')].some(c => c.scrollHeight > c.clientHeight + 1)) } }""")
    ok(info['cover'] and info['toc'], 'songbook: cover and table of contents')
    ok(info['nums'] == [str(i + 1) for i in range(len(info['nums']))], f"songbook: song pages numbered from 1 {info['nums']}")
    ok(all(t in info['nums'] for t in info['tocNums']), f"songbook: contents point to real pages {info['tocNums']}")
    ok(not info['over'], 'songbook: nothing overflows a page')
    # song presentation: cover with date, numbered slides in order, no overflow, presenter works
    pg.click('#book-back'); pg.click('#btn-show'); pg.wait_for_timeout(400)
    ok(pg.inner_text('#book-greet') == 'מצגת שירים' and pg.is_hidden('#bk-book-opts'), 'presentation: own screen and options')
    pg.click('#book-new'); pg.fill('#bk-title', 'ערב'); pg.fill('#bk-date', '2026-12-06'); pg.dispatch_event('#bk-date', 'change')
    for i in range(min(3, len(pg.query_selector_all('#bk-pick [data-add]')))): pg.click(f'#bk-pick li:nth-child({i+1}) [data-add]')
    pg.click('#bk-build'); pg.wait_for_selector('#bk-status:has-text("מוכנה")', timeout=120000)
    sl = pg.evaluate("""() => [...document.querySelectorAll('#bk-preview .slide')].map(s => {
        const b = s.querySelector('.sl-body');
        return { cover: !!s.querySelector('.sl-cover'), date: s.querySelector('.sl-date')?.textContent || '', num: s.querySelector('.sl-num')?.textContent || '',
                 over: b ? (b.scrollHeight > b.clientHeight + 1 || [...s.querySelectorAll('.lt')].some(l => l.scrollWidth > l.clientWidth + 1)) : false,
                 fs: parseFloat(getComputedStyle(s.querySelector('.lt') || s).fontSize) } })""")
    ok(sl[0]['cover'] and 'כ״ו בכסלו תשפ״ז' in sl[0]['date'] and '2026' in sl[0]['date'], 'presentation: cover with Hebrew and Gregorian date')
    nums = [x['num'] for x in sl[1:]]
    ok(nums == ['1', '2', '3'], f'presentation: one slide per song, numbered by order {nums}')
    ok(not any(x['over'] for x in sl), 'presentation: nothing overflows or breaks a line')
    ok(min(x['fs'] for x in sl[1:]) >= 18, f"presentation: lyrics large enough to project (min {min(x['fs'] for x in sl[1:]):.0f}px)")
    ok(len(set(pg.evaluate("() => [...document.querySelectorAll('#bk-preview .slide .bg')].slice(1).map(i => i.getAttribute('src'))"))) == 3, 'presentation: each song in its own soft colour')
    pg.click('#bk-present'); pg.wait_for_timeout(300); pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(100)
    ok(pg.inner_text('.pr-n').startswith('2 /'), 'presentation: full screen, arrow moves to next slide')
    pg.keyboard.press('Escape')
    # a very long song spans slides with the same font and the same columns on every slide;
    # in two columns both start at the same top line
    pg.click('#book-back'); load(songs['veryLong']); pg.wait_for_timeout(900)
    pg.click('#btn-back'); pg.click('#btn-show'); pg.wait_for_timeout(300)
    pg.click('#book-new'); pg.fill('#bk-q', 'בית ארוך'); pg.wait_for_timeout(100)
    pg.fill('#bk-q', ''); 
    pg.evaluate("() => { const b = [...document.querySelectorAll('#bk-pick [data-add]')]; b[b.length - 1].click(); }")
    pg.click('#bk-build'); pg.wait_for_selector('#bk-status:has-text("מוכנה")', timeout=180000)
    lv = pg.evaluate("""() => [...document.querySelectorAll('#bk-preview .slide')].slice(1).map(s => ({
        fs: getComputedStyle(s).getPropertyValue('--sfs').trim(), two: !!s.querySelector('.sl-body.two'),
        tops: [...s.querySelectorAll('.sl-col')].map(c => Math.round(c.firstElementChild.getBoundingClientRect().top)),
        over: [...s.querySelectorAll('.lt')].some(l => l.scrollWidth > l.clientWidth + 1) || s.querySelector('.sl-body').scrollHeight > s.querySelector('.sl-body').clientHeight + 1 }))""")
    ok(len(lv) >= 2 and len({x['fs'] for x in lv}) == 1 and len({x['two'] for x in lv if True}) == 1, f"presentation: a song over several slides keeps one font and layout {[(x['fs'], x['two']) for x in lv]}")
    ok(all(len(set(x['tops'])) <= 1 for x in lv), 'presentation: two columns start at the same top line')
    ok(not any(x['over'] for x in lv), 'presentation: long song does not overflow')
    b.close()
print(f'\n{fail} FAILED' if fail else '\nall layout tests passed'); raise SystemExit(1 if fail else 0)
