(function () {
  'use strict';
  /* the marketing page is for the web only: anyone who has used the app, or opens this in the installed app, goes straight to it */
  try {
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (standalone || localStorage.getItem('rep.seen') === '1') { location.replace('/app/'); return; }
  } catch (e) {}
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* mobile menu */
  var menu = $('.lp-menu'), drop = $('.lp-drop');
  function setMenu(open) {
    if (!menu || !drop) return;
    drop.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    var ic = $('.ic', menu);
    ic.classList.toggle('ic-x', open);
    ic.classList.toggle('ic-list', !open);
  }
  if (menu) {
    menu.addEventListener('click', function () { setMenu(menu.getAttribute('aria-expanded') !== 'true'); });
    $$('a', drop).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { setMenu(false); menu.focus(); }
    });
  }

  /* install tabs: default from the visitor's device */
  var tabs = $$('.lp-tabs button');
  function pickTab(id) {
    tabs.forEach(function (b) {
      var on = b.getAttribute('data-tab') === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('.lp-panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== id; });
  }
  function detect() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'; /* iPadOS */
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { pickTab(b.getAttribute('data-tab')); }); });
  if (tabs.length) pickTab(detect());

  /* FAQ accordion: one open at a time, first open by default */
  var qs = $$('.lp-q > button');
  function setQ(btn, open) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    var ic = $('.ic', btn);
    ic.classList.toggle('ic-minus', open);
    ic.classList.toggle('ic-plus', !open);
    document.getElementById(btn.getAttribute('aria-controls')).hidden = !open;
  }
  qs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      qs.forEach(function (o) { setQ(o, o === btn && open); });
    });
    btn.addEventListener('keydown', function (e) {
      var i = qs.indexOf(btn), n = null;
      if (e.key === 'ArrowDown') n = qs[(i + 1) % qs.length];
      else if (e.key === 'ArrowUp') n = qs[(i - 1 + qs.length) % qs.length];
      else if (e.key === 'Home') n = qs[0];
      else if (e.key === 'End') n = qs[qs.length - 1];
      if (n) { e.preventDefault(); n.focus(); }
    });
  });
})();
