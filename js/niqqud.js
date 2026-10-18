// Automatic niqqud with Dicta's Nakdan. The endpoint is not officially documented and may change;
// on any failure the caller falls back to opening the Nakdan website.
const ENDPOINT = 'https://nakdan-2-0.loadbalancer.dicta.org.il/api';

export async function vocalize(text, genre = 'poetry') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'nakdan', genre, data: text, addmorph: false, keepqq: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('bad response');
    return raw.map((w) => (w.sep || !Array.isArray(w.options) || !w.options.length ? w.word : String(w.options[0]).replace(/\|/g, ''))).join('');
  } finally { clearTimeout(t); }
}
