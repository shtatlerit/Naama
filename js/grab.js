// Source of the "עצב לנעמה" bookmarklet. install.html turns this function into a javascript: link.
// It runs on a Shironet song page (lyrics or chords), finds the lyrics, and opens the app with the song.
export function grab() {
  var APP = 'https://shtatlerit.github.io/Naama/';
  if (!/shironet/.test(location.hostname)) { alert('הכפתור עובד בדף של שיר בשירונט'); return; }
  var sels = ['.artist_lyrics_text', '.artist_lyrics_text_chords', '.artist_chords_text', '.lyrics', 'pre'];
  var L = null, i, e;
  for (i = 0; i < sels.length; i++) {
    e = document.querySelector(sels[i]);
    if (e && (e.innerText || '').trim().split('\n').length > 3) { L = e; break; }
  }
  if (!L) {
    var best = null, bs = 0;
    document.querySelectorAll('div,span,td,pre,p,section,article').forEach(function (el) {
      var t = el.innerText || '';
      if (t.length < 40 || t.length > 8000) return;
      var ls = t.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var heb = ls.filter(function (s) { return /[֐-׿]/.test(s) && s.length < 60; }).length;
      var linkLen = 0; el.querySelectorAll('a').forEach(function (a) { linkLen += (a.innerText || '').length; });
      if (linkLen > t.length * 0.25) return;
      var sc = heb - t.length / 3000;
      if (sc > bs || (best && best.contains(el) && sc >= bs * 0.9)) { best = el; bs = Math.max(sc, bs); }
    });
    L = best;
  }
  if (!L) { alert('לא מצאתי את מילות השיר בדף הזה'); return; }
  var text = L.innerText;
  var body = document.body.innerText;
  var first = text.trim().split('\n')[0].trim();
  var at = body.indexOf(first);
  var head = at > 0 ? body.slice(Math.max(0, at - 1500), at) : '';
  var data = { v: 1, url: location.href, title: document.title, head: head, text: text };
  location.href = APP + '#import=' + encodeURIComponent(JSON.stringify(data));
}
