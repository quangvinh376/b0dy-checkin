/* Test màn chuyển (moved.js) + bản tự gỡ service worker (sw.js) — Playwright, Chromium, máy chủ giả.
   Chạy: NODE_PATH=/opt/node22/lib/node_modules node test/moved.js
   PIN, tên khách, IP đều là giả (repo public). */
var { chromium } = require('playwright'); var http = require('http'); var fs = require('fs'); var path = require('path');
var CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
var ROOT = path.resolve(__dirname, '..'), PORT = +process.env.PORT || 19611, OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };
var EXTRA = {   /* service worker giả của app coach cũ, đăng ký ở đường khác để kiểm moved.js gỡ được mọi đăng ký */
  '/old-sw.js': "self.addEventListener('install',function(){self.skipWaiting()});self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});self.addEventListener('fetch',function(){});"
};
var HITS = {};
function serve() {
  return new Promise(function (res) {
    var s = http.createServer(function (req, rsp) {
      var u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
      HITS[u] = (HITS[u] || 0) + 1;
      if (EXTRA[u]) { rsp.writeHead(200, { 'Content-Type': MIME['.js'] }); rsp.end(EXTRA[u]); return; }
      var f = path.join(ROOT, u);
      if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    s.listen(PORT, function () { res(s); });
  });
}

/* ---------- máy chủ giả: Worker + Apps Script (cả deployment coach lẫn kiosk) ---------- */
var COACH_PIN = '1111', ADMIN_PIN = '9999';
var MEM_COACH = [{ name: 'Khách A' }, { name: 'Khách B' }], MEM_ALL = MEM_COACH.concat([{ name: 'Khách C' }]);
var LOG = [];            /* {via, action, ids, keys} mỗi lệnh ghi */
var MODE = { wkLog: 'ok' };  /* 'ok' | 'unconf' | 'neterr' */
function route(via, p) {
  var a = p.action;
  if (a === 'ping') return { ok: true, pong: 1 };
  if (a === 'members') return { ok: true, members: [{ name: 'Khách A', total: 12, done: 3, left: 9, coach: 'Coach Thử' }] };
  if (a === 'checkin' || a === 'pending') return via === 'wk' ? { ok: false, error: 'wrong_ip', seen: '203.0.113.5', asn: 1, relay: false } : { ok: false, error: 'wrong_ip' };
  if (a === 'coach') return p.pin === COACH_PIN ? { ok: true, coach: 'Coach Thử', members: MEM_COACH } : { ok: false, error: 'sai_pin' };
  if (a === 'admin') return p.apin === ADMIN_PIN ? { ok: true } : { ok: false, error: 'sai_pin' };
  if (a === 'adm_data') { if (via !== 'gas') return { ok: false, error: 'unknown_action' }; return p.apin === ADMIN_PIN ? { ok: true, coach: 'Admin', members: MEM_ALL } : { ok: false, error: 'sai_pin' }; }
  if (a === 'log') {
    if (p.pin !== COACH_PIN) return { ok: false, error: 'sai_pin' };
    if (via === 'wk' && MODE.wkLog === 'unconf') return { ok: false, error: 'wk_unconfigured' };
    LOG.push({ via: via, action: a, ids: (p.events || []).map(function (e) { return e.id; }), keys: (p.events || []).map(function (e) { return Object.keys(e).sort().join(','); }), gas: !!p._gas });
    return { ok: true, written: (p.events || []).length, dup: 0 };
  }
  if (a === 'adm_log') {
    if (via !== 'gas') return { ok: false, error: 'unknown_action' };
    if (p.apin !== ADMIN_PIN) return { ok: false, error: 'sai_pin' };
    LOG.push({ via: via, action: a, ids: (p.events || []).map(function (e) { return e.id; }) });
    return { ok: true, written: (p.events || []).length, dup: 0 };
  }
  return { ok: false, error: 'unknown_action' };
}
async function mock(ctx) {
  await ctx.route(/fontshare|fonts\.googleapis|fonts\.gstatic/, function (r) { return r.fulfill({ status: 200, contentType: 'text/css', body: '' }); });
  await ctx.route(/api\.ipify\.org/, function (r) { return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ip":"203.0.113.5"}' }); });
  await ctx.route(/workers\.dev/, function (r) {
    if (MODE.wkLog === 'neterr') { var b0 = {}; try { b0 = JSON.parse(r.request().postData() || '{}'); } catch (e) {} if (b0.action === 'log') return r.abort('failed'); }
    var p = {}; try { p = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(route('wk', p)) });
  });
  await ctx.route(/script\.google\.com/, function (r) {
    var p = {}; try { p = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(route('gas', p)) });
  });
}

var pass = 0, fail = 0, PAGEERR = [];
function check(label, cond, extra) { if (cond) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); } }
function ev(id, name, coach, extra) { return Object.assign({ id: id, type: 'SET', date: '2026-10-13', name: name, coach: coach, ex: 'Squat', set: 1, kg: 60, rep: 8, ok: 1 }, extra || {}); }

async function page(browser, ls, opts) {
  opts = opts || {};
  var ctx = await browser.newContext({ viewport: opts.vp || { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await mock(ctx);
  if (opts.blockMoved) await ctx.route(/moved\.js/, function (r) { return r.abort('failed'); });
  var pg = await ctx.newPage();
  pg.on('pageerror', function (e) { PAGEERR.push(String(e)); });
  await pg.goto('http://localhost:' + PORT + '/sw-blank', { waitUntil: 'domcontentloaded' }).catch(function () {});
  if (ls) await pg.evaluate(function (o) { localStorage.clear(); for (var k in o) localStorage.setItem(k, o[k]); }, ls);
  else await pg.evaluate(function () { localStorage.clear(); });
  if (opts.before) await opts.before(pg);
  HITS = {};
  await pg.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  await pg.waitForTimeout(400);
  return { ctx: ctx, pg: pg };
}
var vis = function (pg, sel) { return pg.evaluate(function (s) { var e = document.querySelector(s); if (!e) return false; var r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel); };
var outbox = function (pg) { return pg.evaluate(function () { try { return JSON.parse(localStorage.getItem('lb_outbox') || '[]'); } catch (e) { return 'ERR'; } }); };
async function typePin(pg, pin) { await pg.fill('#mv input', pin); await pg.click('#mv .pend .btn.pri'); await pg.waitForFunction(function () { var b = document.querySelector('#mv .pend .btn.pri'); return b && !b.disabled; }, null, { timeout: 15000 }); await pg.waitForTimeout(100); }
var msg = function (pg) { return pg.evaluate(function () { return document.querySelector('#mv .msg').textContent; }); };

(async function () {
  var srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  var r, s;

  console.log('== M1 máy kiosk (không có lb_*) — không đổi gì ==');
  s = await page(browser, { b0dy_ip: '203.0.113.5' });
  check('không nạp moved.js', !HITS['/moved.js'], HITS);
  check('không có #mv, html không có class moved', !(await s.pg.$('#mv')) && !(await s.pg.evaluate(function () { return document.documentElement.classList.contains('moved'); })));
  check('màn danh sách kiosk hiện', await vis(s.pg, '#s-list'));
  await s.pg.screenshot({ path: path.join(OUT, 'm1-kiosk.png') });
  await s.ctx.close();

  console.log('== M2 máy coach cũ, hàng đợi rỗng ==');
  s = await page(browser, { lb_last: '{"coach":"Coach Thử","h":"x","adm":0}', lb_data_x: '{}', lb_ip: '203.0.113.5' });
  check('nạp moved.js', HITS['/moved.js'] === 1, HITS);
  check('#mv hiện', await vis(s.pg, '#mv'));
  check('kiosk bị ẩn', !(await vis(s.pg, '#s-list')));
  check('khối chưa gửi ẩn', !(await vis(s.pg, '#mv .pend')));
  r = await s.pg.evaluate(function () { var a = document.querySelector('#mv a.btn'); return { href: a.href, cls: a.className }; });
  check('nút Acid "Mở checkin.b0dy.studio" trỏ domain mới', r.href === 'https://checkin.b0dy.studio/' && /\bpri\b/.test(r.cls), r);
  await s.pg.screenshot({ path: path.join(OUT, 'm2-moved.png') });
  await s.pg.click('#mv .link');
  await s.pg.waitForTimeout(200);
  check('"Vào kiosk check-in" → gỡ màn, kiosk hiện', !(await s.pg.$('#mv')) && (await vis(s.pg, '#s-list')));
  await s.ctx.close();

  console.log('== M3 hàng đợi: sai PIN · PIN coach (lọc khách thật) · bỏ thao tác thử · PIN Admin ==');
  var q = [ev('a1', 'Khách A', 'Coach Thử', { hold: 1 }), ev('a2', 'Khách B', 'Coach Thử'), ev('a3', 'Khách A', 'Coach Thử', { type: 'ĐO', metric: 'weight', val: 70 }),
           ev('d1', 'Khách Demo 1', 'Coach Thử'), ev('d2', 'Khách Demo 2', 'Coach Thử'), ev('m1', 'Khách C', 'Admin')];
  LOG = []; MODE.wkLog = 'ok';
  s = await page(browser, { lb_outbox: JSON.stringify(q), lb_last: '{"coach":"Coach Thử","h":"x","adm":0}' });
  check('khối chưa gửi hiện, số = 6', (await vis(s.pg, '#mv .pend')) && (await s.pg.textContent('#mv .num')) === '6');
  r = await s.pg.evaluate(function () { return document.querySelector('#mv a.btn').className; });
  check('còn hàng đợi → nút mở app mới là ghost (Gửi là hành động chính)', /\bgho\b/.test(r), r);
  await s.pg.screenshot({ path: path.join(OUT, 'm3-pending.png') });
  await typePin(s.pg, '0000');
  check('sai PIN → báo "Sai PIN", không ghi gì', (await msg(s.pg)) === 'Sai PIN' && LOG.length === 0, { m: await msg(s.pg), LOG: LOG });
  await typePin(s.pg, COACH_PIN);
  check('PIN coach → gửi đúng 3 sự kiện của khách thật qua Worker', LOG.length === 1 && LOG[0].via === 'wk' && LOG[0].ids.join() === 'a1,a2,a3', LOG);
  check('không gửi trường hold', LOG[0] && LOG[0].keys.every(function (k) { return k.split(',').indexOf('hold') < 0; }), LOG[0] && LOG[0].keys);
  var ob = await outbox(s.pg);
  check('hàng đợi còn 2 thao tác thử + 1 của Admin', ob.map(function (e) { return e.id; }).join() === 'd1,d2,m1', ob);
  check('báo "Đã gửi 3 thao tác — còn 3"', (await msg(s.pg)) === 'Đã gửi 3 thao tác — còn 3', await msg(s.pg));
  check('nút bỏ thao tác không khớp hiện (2)', (await vis(s.pg, '#mv .skip')) && /Bỏ 2 /.test(await s.pg.textContent('#mv .skip')), await s.pg.textContent('#mv .skip'));
  await s.pg.click('#mv .skip');
  check('chạm lần 1 chỉ hỏi lại, chưa bỏ', (await outbox(s.pg)).length === 3 && /lần nữa/.test(await s.pg.textContent('#mv .skip')));
  await s.pg.click('#mv .skip');
  ob = await outbox(s.pg);
  check('chạm lần 2 → bỏ d1,d2; còn m1', ob.map(function (e) { return e.id; }).join() === 'm1', ob);
  await typePin(s.pg, ADMIN_PIN);
  check('PIN Admin → adm_log qua Apps Script, đúng m1', LOG.length === 2 && LOG[1].action === 'adm_log' && LOG[1].via === 'gas' && LOG[1].ids.join() === 'm1', LOG);
  ob = await outbox(s.pg);
  check('hàng đợi rỗng → xoá khoá lb_outbox', (await s.pg.evaluate(function () { return localStorage.getItem('lb_outbox'); })) === null, ob);
  check('khối chưa gửi ẩn, nút mở app mới thành Acid', !(await vis(s.pg, '#mv .pend')) && /\bpri\b/.test(await s.pg.evaluate(function () { return document.querySelector('#mv a.btn').className; })));
  await s.ctx.close();

  console.log('== M4 Worker từ chối (wk_unconfigured) / lỗi mạng → lui về Apps Script, không gửi trùng ==');
  LOG = []; MODE.wkLog = 'unconf';
  s = await page(browser, { lb_outbox: JSON.stringify([ev('u1', 'Khách A', 'Coach Thử')]) });
  await typePin(s.pg, COACH_PIN);
  check('wk_unconfigured → Apps Script ghi 1 lần (_gas)', LOG.length === 1 && LOG[0].via === 'gas' && LOG[0].gas && LOG[0].ids.join() === 'u1', LOG);
  await s.ctx.close();
  LOG = []; MODE.wkLog = 'neterr';
  s = await page(browser, { lb_outbox: JSON.stringify([ev('n1', 'Khách B', 'Coach Thử')]) });
  await typePin(s.pg, COACH_PIN);
  check('Worker lỗi mạng (log) → Apps Script ghi 1 lần', LOG.length === 1 && LOG[0].via === 'gas' && LOG[0].ids.join() === 'n1', LOG);
  check('hàng đợi rỗng sau khi gửi', (await s.pg.evaluate(function () { return localStorage.getItem('lb_outbox'); })) === null);
  await s.ctx.close();
  MODE.wkLog = 'ok';

  console.log('== M5 gửi theo lô ≤150 ==');
  LOG = []; var big = []; for (var i = 0; i < 320; i++) big.push(ev('b' + i, i % 2 ? 'Khách A' : 'Khách B', 'Coach Thử'));
  s = await page(browser, { lb_outbox: JSON.stringify(big) });
  check('số = 320', (await s.pg.textContent('#mv .num')) === '320');
  await typePin(s.pg, COACH_PIN);
  check('3 lô 150/150/20, đủ 320 id không trùng', LOG.length === 3 && LOG[0].ids.length === 150 && LOG[1].ids.length === 150 && LOG[2].ids.length === 20 &&
    new Set([].concat(LOG[0].ids, LOG[1].ids, LOG[2].ids)).size === 320, LOG.map(function (x) { return x.ids.length; }));
  await s.ctx.close();

  console.log('== M6 dọn service worker + cache của app coach cũ ==');
  s = await page(browser, { lb_last: '{"coach":"Coach Thử"}' }, { before: async function (pg) {
    await pg.goto('http://localhost:' + PORT + '/manifest-none', { waitUntil: 'domcontentloaded' }).catch(function () {});
    await pg.evaluate(async function () {
      await navigator.serviceWorker.register('/old-sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      var c = await caches.open('b0dy-coach-v2.15.0'); await c.put('/x', new Response('x'));
    });
  } });
  await s.pg.waitForTimeout(800);
  r = await s.pg.evaluate(async function () { return { regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length }; });
  check('moved.js gỡ hết đăng ký service worker + xoá cache', r.regs === 0 && r.caches === 0, r);
  await s.ctx.close();

  console.log('== M7 sw.js tự gỡ (đường cập nhật của service worker cũ) ==');
  s = await page(browser, null);
  r = await s.pg.evaluate(async function () {
    var c = await caches.open('b0dy-coach-v2.15.0'); await c.put('/x', new Response('x'));
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    for (var i = 0; i < 40; i++) { await new Promise(function (r) { setTimeout(r, 100); }); var rs = await navigator.serviceWorker.getRegistrations(); if (!rs.length) break; }
    return { regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length };
  });
  check('sw.js: cài → xoá cache → tự gỡ', r.regs === 0 && r.caches === 0, r);
  await s.ctx.close();

  console.log('== M8 moved.js không tải được → kiosk vẫn hiện (không trắng màn) ==');
  s = await page(browser, { lb_last: '{"coach":"x"}' }, { blockMoved: true });
  check('class moved được gỡ, kiosk hiện', !(await s.pg.evaluate(function () { return document.documentElement.classList.contains('moved'); })) && (await vis(s.pg, '#s-list')));
  await s.ctx.close();

  console.log('== M9 màn nhỏ 375×667: cuộn được tới nút cuối, không tràn ngang ==');
  s = await page(browser, { lb_outbox: JSON.stringify(q.slice(0, 2)) }, { vp: { width: 375, height: 667 } });
  r = await s.pg.evaluate(function () { var m = document.getElementById('mv'); return { sw: m.scrollWidth, cw: m.clientWidth, sh: m.scrollHeight, ch: m.clientHeight }; });
  check('không tràn ngang', r.sw <= r.cw, r);
  await s.pg.screenshot({ path: path.join(OUT, 'm9-375.png'), fullPage: false });
  await s.pg.evaluate(function () { var m = document.getElementById('mv'); m.scrollTop = m.scrollHeight; });
  check('cuộn tới "Vào kiosk check-in"', await s.pg.evaluate(function () { var b = document.querySelector('#mv .link').getBoundingClientRect(); return b.bottom <= innerHeight + 1 && b.top >= 0; }));
  await s.ctx.close();

  await browser.close(); srv.close();
  check('0 pageerror', PAGEERR.length === 0, PAGEERR);
  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
