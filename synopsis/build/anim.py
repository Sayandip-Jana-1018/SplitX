"""
Animation layer for the SplitX synopsis.

A PDF page cannot hold CSS/SVG animation — the only motion a PDF format really
supports is a page-transition dictionary, which is applied separately in
build.py.  So the animated artefact is a second HTML file built from exactly
the same page markup, with this stylesheet and script appended.

Everything here is additive: the static document already renders in its final
state, and every rule below only animates *towards* that state, so nothing can
end up half-drawn.
"""

CSS = r"""
/* ══════════════════════════════ animated presentation shell ══════════════ */
html{ scroll-behavior:smooth; }
body.anim{
  background:
    radial-gradient(1200px 700px at 12% -8%, #eef4ff 0%, transparent 60%),
    radial-gradient(1000px 600px at 92% 12%, #fdf2f8 0%, transparent 55%),
    linear-gradient(180deg,#f6f8fc 0%, #eef1f7 100%);
  background-attachment:fixed;
  padding:26px 0 120px;
}
body.anim .page{
  margin:0 auto 26px;
  border-radius:14px;
  box-shadow:0 1px 2px rgba(15,23,42,.06), 0 18px 46px -12px rgba(15,23,42,.24);
  transition:opacity .62s cubic-bezier(.22,.85,.3,1),
             transform .62s cubic-bezier(.22,.85,.3,1);
}
body.anim .page.pre{ opacity:0; transform:translateY(26px) scale(.985); }
body.anim .page.in { opacity:1; transform:none; }

/* the coloured spine grows down the page edge */
body.anim .page::before{ transform-origin:top; }
body.anim .page.pre::before{ transform:scaleY(0); }
body.anim .page.in::before{
  transform:scaleY(1);
  transition:transform .9s cubic-bezier(.22,.85,.3,1) .1s;
}

/* ── header ── */

body.anim .page.in .phead{
  animation:headline .8s cubic-bezier(.22,.85,.3,1) .18s both;
}
@keyframes headline{
  from{ border-bottom-color:transparent; }
  to  { border-bottom-color:var(--c1); }
}

body.anim .page.in .pnum{
  animation:pnumIn .62s cubic-bezier(.34,1.56,.5,1) .2s both;
}
@keyframes pnumIn{ from{ opacity:0; transform:rotate(-16deg) scale(.6); }
                   to  { opacity:1; transform:none; } }

body.anim .page.in .ptitle{ animation:slideIn .55s ease-out .26s both; }
body.anim .page.in .pkind { animation:slideIn .55s ease-out .34s both; }
@keyframes slideIn{ from{ opacity:0; transform:translateX(-10px); }
                    to  { opacity:1; transform:none; } }

/* ── figures: a soft directional wipe reveals the drawing, then the
      connectors draw themselves on top of it ── */
@property --wipe{ syntax:'<percentage>'; inherits:false; initial-value:0%; }

body.anim .fig > svg{
  --wipe:120%;
  -webkit-mask-image:linear-gradient(var(--wdir,90deg),
        #000 calc(var(--wipe) - 16%), transparent var(--wipe));
  mask-image:linear-gradient(var(--wdir,90deg),
        #000 calc(var(--wipe) - 16%), transparent var(--wipe));
}
body.anim .page.in .fig > svg{
  animation:figWipe 1.05s cubic-bezier(.36,0,.22,1) var(--fd,.28s) both;
}
@keyframes figWipe{ from{ --wipe:0%; } to{ --wipe:120%; } }
/* the resting value above is already 120%, so a figure whose animation
   never runs is simply shown in full */

/* if anything ever prevents the animation from running, show the figure */
body.anim .fig > svg.shown{
  -webkit-mask-image:none !important; mask-image:none !important;
}

/* connectors draw themselves; --len is measured by the script */
body.anim svg path.draw{
  stroke-dasharray:var(--len);
  stroke-dashoffset:0;                 /* rests fully drawn */
}
body.anim .page.in svg path.draw{
  animation:drawOn var(--dur,1.05s) cubic-bezier(.4,0,.25,1) var(--dd,.85s) both;
}
@keyframes drawOn{ from{ stroke-dashoffset:var(--len); }
                   to  { stroke-dashoffset:0; } }

/* dashed connectors keep their dashes and gently march instead */
body.anim .page.in svg path.march{ animation:march 2.4s linear infinite; }
@keyframes march{ to{ stroke-dashoffset:-40; } }

/* flow particles injected by the script */
body.anim circle.particle{ opacity:.92; }

/* ── page 1 ── */
body.anim .hero{ position:relative; overflow:hidden; }
body.anim .hero::after{
  content:''; position:absolute; inset:0;
  background:linear-gradient(105deg, transparent 30%,
             rgba(255,255,255,.42) 47%, transparent 64%);
  transform:translateX(-120%);
}
body.anim .page.in .hero::after{ animation:sheen 2.6s ease-in-out 1s infinite; }
@keyframes sheen{ 0%{transform:translateX(-120%)} 55%,100%{transform:translateX(120%)} }


body.anim .page.in .hero h1{ animation:slideUp .7s cubic-bezier(.22,.85,.3,1) .3s both; }

body.anim .page.in .hero .tag{ animation:slideUp .7s cubic-bezier(.22,.85,.3,1) .42s both; }
@keyframes slideUp{ from{ opacity:0; transform:translateY(13px); }
                    to  { opacity:1; transform:none; } }

body.anim .page.in .hero .hchips span{
  animation:popUp .5s cubic-bezier(.34,1.4,.5,1) calc(.56s + var(--i,0)*.035s) both;
}
body.anim .page.in .card{
  animation:popUp .62s cubic-bezier(.22,.85,.3,1) calc(.62s + var(--i,0)*.11s) both;
}
body.anim .page.in .srow .sv span{
  animation:popUp .42s ease-out calc(.9s + var(--i,0)*.014s) both;
}
body.anim .page.in .stat{
  animation:popUp .55s cubic-bezier(.34,1.5,.5,1) calc(1.15s + var(--i,0)*.07s) both;
}
body.anim .page.in .concl .cc{
  animation:popUp .6s cubic-bezier(.22,.85,.3,1) calc(.5s + var(--i,0)*.13s) both;
}
body.anim .page.in table.tm tbody tr{
  animation:popUp .42s ease-out calc(.55s + var(--i,0)*.032s) both;
}
@keyframes popUp{ from{ opacity:0; transform:translateY(9px); }
                  to  { opacity:1; transform:none; } }

/* ── page 4: the four build-failing gates pulse ── */
body.anim .page.in svg rect.gate{ animation:gatePulse 2.1s ease-in-out 1.6s infinite; }
@keyframes gatePulse{
  0%,100%{ stroke-width:1.4; }
  50%    { stroke-width:3.1; }
}

/* ── page 5: the terminal prints itself line by line ── */
body.anim .term{ position:relative; }
body.anim .term .tl{ display:block; }
body.anim .term .tl:empty::after{ content:" "; }
body.anim .page.in .term .tl{
  animation:termLine .16s ease-out calc(.45s + var(--i,0)*.075s) both;
}
@keyframes termLine{ from{ opacity:0; } to{ opacity:1; } }
body.anim .term .cursor{
  display:inline-block; width:.62em; height:1em; background:#4ade80;
  vertical-align:-.16em; margin-left:.25em;
  animation:blink 1.05s steps(1,end) infinite;
}
@keyframes blink{ 0%,49%{opacity:1} 50%,100%{opacity:0} }

/* ── floating control bar ── */
.ctl{
  position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
  display:flex; align-items:center; gap:6px; z-index:99;
  padding:7px 9px; border-radius:100px; max-width:calc(100vw - 24px);
  background:rgba(255,255,255,.86); backdrop-filter:blur(14px);
  border:1px solid rgba(15,23,42,.09);
  box-shadow:0 10px 34px -8px rgba(15,23,42,.3);
  font:600 12.5px/1 'Segoe UI', system-ui, sans-serif; color:#334155;
}
.ctl button{
  font:inherit; cursor:pointer; color:#334155; white-space:nowrap;
  border:1px solid transparent; background:transparent;
  padding:7px 12px; border-radius:100px;
  display:inline-flex; align-items:center; gap:5px;
  transition:background .16s, color .16s, border-color .16s;
}
.ctl button:hover{ background:#eef2f7; }
.ctl button.on{ background:#4f46e5; color:#fff; }
.ctl .sep{ width:1px; height:19px; background:rgba(15,23,42,.1); margin:0 2px; }
.ctl .pos{ padding:0 11px; color:#64748b; font-variant-numeric:tabular-nums; }
.ctl .pos b{ color:#0f172a; }
@media (max-width: 900px){ .ctl kbd, .ctl .sep:last-of-type{ display:none } }
.ctl kbd{
  font:600 10.5px/1 'Cascadia Code','Consolas',monospace; color:#64748b;
  background:#f1f5f9; border:1px solid #e2e8f0; border-bottom-width:2px;
  border-radius:4px; padding:3px 5px;
}
body.anim.fit{ padding:14px 0 96px; }
body.anim.fit .page{ margin:0 auto 14px; }
.prog{
  position:fixed; left:0; top:0; height:3px; z-index:100;
  background:linear-gradient(90deg,#14b8a6,#6366f1,#f43f5e);
  width:0; transition:width .18s ease-out;
}

/* the printed artefact must never inherit any of this */
@media print{
  html, body.anim{ background:#fff !important; padding:0 !important; }
  /* the on-screen fit zoom must never reach the printed sheet */
  body.anim .page{ zoom:1 !important; }
  body.anim .page{ margin:0 !important; border-radius:0 !important;
                   box-shadow:none !important; opacity:1 !important;
                   transform:none !important; }
  body.anim .page::before{ transform:none !important; }
  /* animations are additive — the resting state is already the finished
     page — so switching them off is enough. Never force opacity here: the
     diagrams use it for real shading. */
  body.anim *, body.anim *::before, body.anim *::after{
    animation:none !important; transition:none !important;
  }
  body.anim svg path.draw{ stroke-dasharray:none !important;
                           stroke-dashoffset:0 !important; }
  body.anim .fig > svg{ -webkit-mask-image:none !important;
                        mask-image:none !important; }
  .ctl, .prog, circle.particle, body.anim .term .cursor{ display:none !important; }
}
@media (prefers-reduced-motion: reduce){
  body.anim *, body.anim *::before, body.anim *::after{
    animation-duration:.01ms !important; animation-delay:0ms !important;
    transition-duration:.01ms !important;
  }
  body.anim .page{ opacity:1; transform:none; }
  body.anim .fig > svg{ -webkit-mask-image:none !important;
                        mask-image:none !important; }
  circle.particle{ display:none; }
}
"""


JS = r"""
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pages = [].slice.call(document.querySelectorAll('.page'));
  document.body.classList.add('anim');
  pages.forEach(function (p) { p.classList.add('pre'); });

  // ── index children so CSS can stagger them ────────────────────────────────
  function idx(sel, root) {
    [].forEach.call((root || document).querySelectorAll(sel), function (el, i) {
      el.style.setProperty('--i', i);
    });
  }
  idx('.hero .hchips span');
  idx('.cards .card');
  idx('.stats .stat');
  idx('.concl .cc');
  pages.forEach(function (p) {
    idx('.srow .sv span', p);
    [].forEach.call(p.querySelectorAll('table.tm tbody'), function (tb) {
      [].forEach.call(tb.rows, function (r, i) { r.style.setProperty('--i', i); });
    });
  });

  // ── split the terminal into one block per output line ─────────────────────
  // Colour markup never spans a newline, so splitting the markup on \n is safe
  // and keeps every <span> intact.
  [].forEach.call(document.querySelectorAll('.term'), function (t) {
    var lines = t.innerHTML.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    t.innerHTML = lines.map(function (ln, i) {
      return '<span class="tl" style="--i:' + i + '">' + ln + '</span>';
    }).join('');
    var last = t.lastElementChild;
    if (last) {
      var cur = document.createElement('span');
      cur.className = 'cursor';
      last.appendChild(cur);
    }
  });

  // ── prepare each figure: measure connectors, tag gates, stagger the draw ──
  var GATE_STROKE = '#ef4444';

  // layered diagrams read better revealed downwards, pipelines rightwards
  var DOWNWARD = { '02': 1, '03': 1, '07': 1, '08': 1 };

  function prepare(svg) {
    if (svg.dataset.ready) return;
    svg.dataset.ready = '1';

    var pg = svg.closest('.page');
    var num = pg ? pg.querySelector('.pnum').textContent.trim() : '';
    svg.style.setProperty('--wdir', DOWNWARD[num] ? '180deg' : '90deg');

    var flow = svg.closest('.fig') && svg.closest('.fig').dataset.flow;
    var paths = [].filter.call(svg.querySelectorAll('path'), function (p) {
      return !p.closest('defs') && p.getAttribute('fill') === 'none';
    });

    var drawable = [];
    paths.forEach(function (p) {
      if (p.getAttribute('stroke-dasharray')) { p.classList.add('march'); return; }
      var len = 0;
      try { len = p.getTotalLength(); } catch (e) { return; }
      if (!len || len > 4000) return;
      p.classList.add('draw');
      p.style.setProperty('--len', len.toFixed(1));
      drawable.push({ el: p, len: len });
    });

    // shorter connectors draw first, so a diagram assembles outward
    drawable.sort(function (a, b) { return a.len - b.len; });
    drawable.forEach(function (d, i) {
      var delay = 0.85 + Math.min(i, 60) * 0.012;
      d.el.style.setProperty('--dd', delay.toFixed(3) + 's');
      d.el.style.setProperty('--dur', Math.min(1.5, 0.35 + d.len / 950).toFixed(2) + 's');
    });

    // the red-outlined stages on page 4 are the build-failing gates
    [].forEach.call(svg.querySelectorAll('rect'), function (r) {
      if ((r.getAttribute('stroke') || '').toLowerCase() === GATE_STROKE) {
        r.classList.add('gate');
      }
    });

    if (flow && !reduced) addParticles(svg, drawable);
  }

  // ── travelling dots on the main request paths of the flow diagrams ───────────
  var uid = 0;
  function addParticles(svg, drawable) {
    var pool = drawable.filter(function (d) {
      return d.el.getAttribute('marker-end') && d.len > 14 && d.len < 900;
    }).slice(0, 26);
    if (!pool.length) return;

    var ns = 'http://www.w3.org/2000/svg';
    var host = document.createElementNS(ns, 'g');
    host.setAttribute('class', 'particles');

    pool.forEach(function (d, i) {
      var id = 'fp' + (++uid);
      d.el.id = d.el.id || id;
      var col = d.el.getAttribute('stroke') || '#6366f1';
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('r', '3.1');
      c.setAttribute('fill', col);
      c.setAttribute('class', 'particle');
      var m = document.createElementNS(ns, 'animateMotion');
      m.setAttribute('dur', (0.9 + d.len / 260).toFixed(2) + 's');
      m.setAttribute('begin', (2.1 + i * 0.16).toFixed(2) + 's');
      m.setAttribute('repeatCount', 'indefinite');
      m.setAttribute('keyPoints', '0;1');
      m.setAttribute('keyTimes', '0;1');
      m.setAttribute('calcMode', 'linear');
      var mp = document.createElementNS(ns, 'mpath');
      mp.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + d.el.id);
      mp.setAttribute('href', '#' + d.el.id);
      m.appendChild(mp);
      c.appendChild(m);
      host.appendChild(c);
    });
    svg.appendChild(host);
  }

  // ── count-up on the page-1 key numbers ────────────────────────────────────
  function countUp(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    var raw = el.textContent.trim();
    el.dataset.final = raw;
    var m = raw.match(/^(\D*)(\d+)(.*)$/);
    if (!m || reduced) return;
    var pre = m[1], end = parseInt(m[2], 10), post = m[3], t0 = 0;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / 1100);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + Math.round(end * e) + post;
      if (k < 1) requestAnimationFrame(step);
    }
    el.textContent = pre + '0' + post;
    requestAnimationFrame(step);
  }

  // ── reveal pages as they scroll into view ─────────────────────────────────
  function activate(p) {
    p.classList.remove('pre');
    p.classList.add('in');
    [].forEach.call(p.querySelectorAll('.fig > svg'), prepare);
    setTimeout(function () {
      [].forEach.call(p.querySelectorAll('.stat b'), countUp);
    }, 1150);
    // safety net: whatever happens to the animation, the figure must be visible
    setTimeout(function () {
      [].forEach.call(p.querySelectorAll('.fig > svg'), function (s) {
        s.classList.add('shown');
      });
    }, 2600);
  }

  // last-resort sweep, in case the observer ever misses a page
  setTimeout(function () {
    pages.forEach(function (p) {
      if (p.classList.contains('pre')) activate(p);
    });
  }, 9000);

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { activate(e.target); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 });
  pages.forEach(function (p) { io.observe(p); });

  // ── control bar ───────────────────────────────────────────────────────────
  var bar = document.createElement('div');
  bar.className = 'ctl';
  bar.innerHTML =
    '<button id="ctlPrev" title="Previous page">&#9668;</button>' +
    '<span class="pos"><b id="ctlNow">1</b> / ' + pages.length + '</span>' +
    '<button id="ctlNext" title="Next page">&#9658;</button>' +
    '<span class="sep"></span>' +
    '<button id="ctlReplay">&#10227; Replay</button>' +
    '<button id="ctlFit">&#8690; Fit page</button>' +
    '<button id="ctlAuto">&#9654; Auto-play</button>' +
    '<span class="sep"></span>' +
    '<button id="ctlPrint">&#128438; Print / PDF</button>' +
    '<span class="sep"></span><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>R</kbd><kbd>F</kbd>';
  document.body.appendChild(bar);

  var prog = document.createElement('div');
  prog.className = 'prog';
  document.body.appendChild(prog);

  function current() {
    var mid = innerHeight / 2, best = 0, bd = 1e9;
    pages.forEach(function (p, i) {
      var r = p.getBoundingClientRect();
      var d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function go(i) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    pages[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function replay() {
    var i = current(), p = pages[i];
    p.classList.remove('in');
    p.classList.add('pre');
    [].forEach.call(p.querySelectorAll('.stat b'), function (el) {
      delete el.dataset.done;
    });
    void p.offsetWidth;                       // force a reflow so it restarts
    requestAnimationFrame(function () { activate(p); });
  }

  document.getElementById('ctlPrev').onclick = function () { go(current() - 1); };
  document.getElementById('ctlNext').onclick = function () { go(current() + 1); };
  document.getElementById('ctlReplay').onclick = replay;
  document.getElementById('ctlPrint').onclick = function () { print(); };

  var timer = null, autoBtn = document.getElementById('ctlAuto');
  autoBtn.onclick = function () {
    if (timer) {
      clearInterval(timer); timer = null;
      autoBtn.classList.remove('on');
      autoBtn.innerHTML = '&#9654; Auto-play';
      return;
    }
    autoBtn.classList.add('on');
    autoBtn.innerHTML = '&#10073;&#10073; Pause';
    timer = setInterval(function () {
      var i = current();
      go(i >= pages.length - 1 ? 0 : i + 1);
    }, 6500);
  };

  addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current() + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current() - 1); }
    else if (e.key === 'r' || e.key === 'R') { replay(); }
    else if (e.key === 'Home') { go(0); }
    else if (e.key === 'End') { go(pages.length - 1); }
  });

  var now = document.getElementById('ctlNow');
  function onScroll() {
    now.textContent = current() + 1;
    var max = document.body.scrollHeight - innerHeight;
    prog.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  // ── sizing: fit to width, or fit a whole sheet on screen like a slide ─────
  var A4W = 794, A4H = 1123;                       // 210 x 297 mm at 96 dpi
  var fitPage = false;

  function fit() {
    var s = Math.min((innerWidth - 32) / A4W, 1);
    if (fitPage) {
      s = Math.min((innerWidth - 40) / A4W, (innerHeight - 96) / A4H);
    }
    pages.forEach(function (p) { p.style.zoom = s < 1 ? s : ''; });
    onScroll();
  }

  var fitBtn = document.getElementById('ctlFit');
  function toggleFit() {
    fitPage = !fitPage;
    document.body.classList.toggle('fit', fitPage);
    fitBtn.classList.toggle('on', fitPage);
    fitBtn.innerHTML = fitPage ? '&#8689; Actual size' : '&#8690; Fit page';
    var i = current();
    fit();
    requestAnimationFrame(function () { go(i); });
  }
  fitBtn.onclick = toggleFit;
  addEventListener('keydown', function (e) {
    if (e.key === 'f' || e.key === 'F') toggleFit();
  });

  fit();
  addEventListener('resize', fit);

  // printing must always use the real A4 geometry, never the on-screen zoom
  addEventListener('beforeprint', function () {
    pages.forEach(function (p) { p.style.zoom = ''; });
    // a counter caught mid-roll must print its real value
    [].forEach.call(document.querySelectorAll('.stat b'), function (el) {
      if (el.dataset.final) el.textContent = el.dataset.final;
    });
  });
  addEventListener('afterprint', fit);
})();
"""
