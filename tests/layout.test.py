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
               nums: p.slice(2).map(x => x.querySelector('.pgno')?.textContent),
               tocNums: [...p[1].querySelectorAll('.tn')].map(x => x.textContent),
               over: p.some(x => [...x.querySelectorAll('.content')].some(c => c.scrollHeight > c.clientHeight + 1)) } }""")
    ok(info['cover'] and info['toc'], 'songbook: cover and table of contents')
    ok(info['nums'] == [str(i + 1) for i in range(len(info['nums']))], f"songbook: song pages numbered from 1 {info['nums']}")
    ok(all(t in info['nums'] for t in info['tocNums']), f"songbook: contents point to real pages {info['tocNums']}")
    ok(not info['over'], 'songbook: nothing overflows a page')
    b.close()
print(f'\n{fail} FAILED' if fail else '\nall layout tests passed'); raise SystemExit(1 if fail else 0)
