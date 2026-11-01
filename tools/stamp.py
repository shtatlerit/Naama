#!/usr/bin/env python3
"""Stamp a version on every local CSS/JS reference so phones and the installed app
never mix old and new files after an update (GitHub Pages lets browsers cache files ~10 min).
Run before every commit:  python3 tools/stamp.py"""
import re, pathlib, datetime
root = pathlib.Path(__file__).resolve().parent.parent
ver = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=2))).strftime('%Y%m%d-%H%M')
ref = re.compile(r"""((?:css|js)/[\w.-]+\.(?:css|js)|\./[\w-]+\.js)(\?v=[\w-]+)?(?=['"`])""")
files = [root / 'index.html', root / 'install.html'] + [p for p in (root / 'js').glob('*.js')]
for f in files:
    s = f.read_text(encoding='utf-8')
    n = ref.sub(lambda m: m.group(1) + '?v=' + ver, s)
    n = re.sub(r'(<span [^>]*id="ver">)[^<]*(</span>)', r'\g<1>גרסה ' + ver + r'\2', n)
    if n != s: f.write_text(n, encoding='utf-8')
app = root / 'js' / 'app.js'
a = app.read_text(encoding='utf-8')
app.write_text(re.sub(r"const APP_VERSION = '[^']*';", f"const APP_VERSION = '{ver}';", a), encoding='utf-8')
(root / 'version.txt').write_text(ver + '\n', encoding='utf-8')
print('version', ver)
