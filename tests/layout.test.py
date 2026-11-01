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
    b.close()
print(f'\n{fail} FAILED' if fail else '\nall layout tests passed'); raise SystemExit(1 if fail else 0)
