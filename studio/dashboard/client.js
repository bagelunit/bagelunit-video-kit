// client.js · the video dashboard's script: find and filter, the video card (a side panel), copy buttons, and the
// motion (sections rise in, numbers count up). One state (find, needs you, step, open card) kept in the tab's session
// storage, so a redraw comes back to the same place. Without it the page still shows everything but the card.
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('dash-data').textContent);
  var byId = {}; D.videos.forEach(function (v) { byId[v.id] = v; });
  var body = document.body; body.classList.remove('nojs'); body.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safeUrl = function (u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>\\]+$/i.test(u) ? u : ''; };
  var safeRel = function (u) { u = String(u || ''); return /^[^:<>"']+$/.test(u) ? u : ''; };
  var svg = function (d, cls) { return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; };

  /* motion: rise in and count up */
  var reveal = [].slice.call(document.querySelectorAll('[data-reveal]'));
  reveal.forEach(function (el) { var sib = [].slice.call(el.parentNode.children).filter(function (x) { return x.hasAttribute('data-reveal'); }); el.style.setProperty('--d', Math.max(0, sib.indexOf(el))); });
  var count = function (el) {
    var to = Number(el.getAttribute('data-count')); if (!isFinite(to) || reduce || to === 0) return;
    var t0 = null; var run = function (t) { t0 = t0 || t; var p = Math.min(1, (t - t0) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('en'); if (p < 1) requestAnimationFrame(run); };
    requestAnimationFrame(run);
  };
  var show = function (el) { el.classList.add('in'); [].forEach.call(el.querySelectorAll('[data-count]'), count); if (el.hasAttribute('data-count')) count(el); };
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach(function (el) { io.observe(el); });
  } else reveal.forEach(function (el) { el.classList.add('in'); });

  /* one state */
  var KEY = 'bu-video-dash:' + location.pathname;
  var S = { find: '', needs: false, step: '', open: null };
  try { var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved) S = Object.assign(S, saved); } catch (e) {}
  var save = function () { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  var find = document.getElementById('find'), needsBtn = document.getElementById('needs-only'), stepSel = document.getElementById('step-filter');
  var rows = [].slice.call(document.querySelectorAll('.vrow'));
  var apply = function () {
    var q = S.find.trim().toLowerCase();
    rows.forEach(function (r) {
      var keep = (!q || r.getAttribute('data-find').indexOf(q) >= 0) && (!S.needs || r.getAttribute('data-needs') === '1') && (!S.step || r.getAttribute('data-step') === S.step);
      r.classList.toggle('is-dim', !keep);
    });
    if (find) find.value = S.find; if (needsBtn) needsBtn.setAttribute('aria-pressed', String(S.needs)); if (stepSel) stepSel.value = S.step;
    save();
  };
  if (find) find.addEventListener('input', function () { S.find = find.value; apply(); });
  if (needsBtn) needsBtn.addEventListener('click', function () { S.needs = !S.needs; apply(); });
  if (stepSel) stepSel.addEventListener('change', function () { S.step = stepSel.value; apply(); });
  apply();

  /* the same video lights up everywhere */
  var light = function (id, on) { [].forEach.call(document.querySelectorAll('[data-id="' + id + '"],[data-open="' + id + '"]'), function (el) { (el.closest('.vrow, li') || el).classList.toggle('is-hl', on); }); };
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('[data-open],[data-id]'); if (t) light(t.getAttribute('data-open') || t.getAttribute('data-id'), true); });
  document.addEventListener('mouseout', function (e) { var t = e.target.closest && e.target.closest('[data-open],[data-id]'); if (t) light(t.getAttribute('data-open') || t.getAttribute('data-id'), false); });

  /* copy buttons */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    e.stopPropagation();
    var text = b.getAttribute('data-copy');
    var done = function () { b.classList.add('done'); var old = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.classList.remove('done'); b.textContent = old; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (x) {} t.remove(); }
  });

  /* the video card */
  var dlg = document.getElementById('card'), inner = document.getElementById('card-in');
  var order = rows.map(function (r) { return r.getAttribute('data-id'); });
  var stepNo = function (k) { for (var i = 0; i < D.steps.length; i++) if (D.steps[i].key === k) return i; return -1; };
  var when = function (v, key) {
    if (key === 'map' && v.approvals.map) return 'approved ' + v.approvals.map.at + (v.approvals.map.current ? '' : ' (changed since)');
    if (key === 'facts' && v.facts.script) return v.facts.script.result + ' ' + v.facts.script.at + (v.facts.script.current ? '' : ' (out of date)');
    if (key === 'final' && v.approvals.final) return 'approved ' + v.approvals.final.at + (v.approvals.final.current ? '' : ' (changed since)');
    if (key === 'done' && v.uploadedAt) return v.uploadedAt + ', ' + v.privacy;
    return '';
  };
  var cardHtml = function (v) {
    var at = stepNo(v.step), s = D.steps[at];
    var media = v.video && safeRel(v.video)
      ? '<video controls preload="metadata"' + (v.thumb && safeRel(v.thumb) ? ' poster="' + esc(v.thumb) + '"' : '') + ' src="' + esc(v.video) + '"></video><p class="empty">If it does not play here, open ' + esc(v.video) + ' from the folder.</p>'
      : v.thumb && safeRel(v.thumb) ? '<img class="cthumb" src="' + esc(v.thumb) + '" alt="The thumbnail">' : '';
    var steps = D.steps.map(function (x, i) {
      var cls = i < at || v.step === 'done' ? 'done' : i === at ? 'now' : '';
      var mark = cls === 'done' ? svg('M5 12.5l4.5 4.5L19 7.5') : '';
      return '<li class="' + cls + '"><span class="mk">' + mark + '</span><b>' + esc(x.name) + (cls === 'now' ? ' <span class="sr">(this step)</span>' : '') + '</b><em>' + esc(when(v, x.key) || (cls === 'now' ? (x.who === 'you' ? 'waiting for you' : 'Claude is on it') : '')) + '</em></li>';
    }).join('');
    var next = v.step === 'done'
      ? (safeUrl(v.url) ? '<div class="next"><p>Uploaded.</p><a href="' + esc(safeUrl(v.url)) + '" target="_blank" rel="noopener">Watch on YouTube</a></div>' : '')
      : '<div class="next"><p><b>Next:</b> ' + esc(s.what) + '.</p><code>' + esc(v.next) + '</code> <button class="copy" data-copy="' + esc(v.next) + '">Copy</button></div>';
    var issues = v.issues.length ? '<h4>Needs attention</h4><ul class="kv">' + v.issues.map(function (i) { return '<li><span>' + esc(i.prio) + '</span><span>' + esc(i.text) + '</span></li>'; }).join('') + '</ul>' : '';
    var src = v.sources.length ? '<h4>Sources (' + v.sources.length + ')</h4><ul class="kv">' + v.sources.slice(0, 30).map(function (x) { var u = safeUrl(x.url); return '<li><span>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' : esc(x.title)) + '</span></li>'; }).join('') + '</ul>' : v.noResearch ? '<h4>Sources</h4><p class="empty">No research needed: ' + esc(v.noResearch) + '</p>' : '<h4>Sources</h4><p class="empty">' + esc(v.researchWhy) + '</p>';
    var ch = v.chapters.length ? '<h4>Chapters</h4><ul class="kv">' + v.chapters.map(function (c) { return '<li><span>' + esc(c.at) + '</span><span>' + esc(c.title) + '</span></li>'; }).join('') + '</ul>' : '';
    var qa = v.qa ? '<h4>Quality check' + (v.qa.current ? '' : ' (before the latest render)') + '</h4><ul class="kv">' + v.qa.checks.map(function (c) { return '<li><span>' + esc(c.name) + '</span><span><span class="st ' + esc(c.status) + '">' + esc(c.status) + '</span> ' + esc(c.text) + '</span></li>'; }).join('') + '</ul>' : '';
    var log = v.log.length ? '<h4>Approvals and checks</h4><ul class="kv">' + v.log.slice(0, 12).map(function (l) { return '<li><span>' + esc(l.at) + '</span><span>' + esc(l.kind) + ': ' + esc(l.text) + '</span></li>'; }).join('') + '</ul>' : '';
    var facts = '<h4>About</h4><ul class="kv"><li><span>Style</span><span>' + esc(v.style) + '</span></li><li><span>Length</span><span>' + esc(v.len) + (v.lengthKind === 'estimate' ? ' (estimate)' : '') + '</span></li><li><span>Scenes</span><span>' + v.sceneCount + '</span></li><li><span>Script</span><span>' + v.scriptWords.toLocaleString('en') + ' words</span></li><li><span>Folder</span><span>' + esc(v.rel) + ' (' + Math.round(v.bytes / 1048576) + ' MB)</span></li></ul>';
    return '<div class="card-top"><div><div class="label"><span class="chip">' + svg(D.icons[v.step]) + '</span>' + esc(s.name) + '</div><h3 id="card-title">' + esc(v.name) + '</h3></div><button class="close" id="card-close" aria-label="Close">&times;</button></div>'
      + media + next + issues + '<h4>Steps</h4><ol class="csteps">' + steps + '</ol>' + src + ch + qa + log + facts;
  };
  var open = function (id, push) {
    var v = byId[id]; if (!v || !dlg) return;
    inner.innerHTML = cardHtml(v);
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    rows.forEach(function (r) { r.classList.toggle('is-sel', r.getAttribute('data-id') === id); });
    S.open = id; save();
    if (push !== false) history.replaceState(null, '', '#video=' + encodeURIComponent(id));
    var c = document.getElementById('card-close'); if (c) c.addEventListener('click', close);
  };
  var close = function () {
    [].forEach.call(dlg.querySelectorAll('video'), function (x) { x.pause(); });
    if (dlg.open) dlg.close(); S.open = null; save();
    rows.forEach(function (r) { r.classList.remove('is-sel'); });
    history.replaceState(null, '', location.pathname + location.search);
  };
  if (dlg) {
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('close', function () { if (S.open) { S.open = null; save(); } });
    dlg.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.target && /INPUT|VIDEO|SELECT/.test(e.target.tagName)) return;
      var i = order.indexOf(S.open); if (i < 0) return;
      var j = i + (e.key === 'ArrowDown' ? 1 : -1); if (j < 0 || j >= order.length) return;
      e.preventDefault(); open(order[j]);
    });
  }
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-open]'); if (t && !e.target.closest('[data-copy]')) { e.preventDefault(); open(t.getAttribute('data-open')); } });
  var m = location.hash.match(/^#video=(.+)$/);
  if (m && byId[decodeURIComponent(m[1])]) open(decodeURIComponent(m[1]), false);
  else if (S.open && byId[S.open]) open(S.open);
})();
