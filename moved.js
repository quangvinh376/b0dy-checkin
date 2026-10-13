/* B0DY · demo.b0dy.studio — màn chuyển cho máy từng cài APP COACH ở domain này (13/10/2026).

   Từ 13/10/2026 app coach chạy ở checkin.b0dy.studio; domain này (demo.b0dy.studio) phục vụ kiosk check-in.
   index.html chỉ nạp file này khi localStorage của domain còn khoá lb_* (dữ liệu app coach) — tức là máy coach
   mở biểu tượng cũ trên Home Screen. Máy kiosk không có lb_* nên không bao giờ thấy màn này.

   Việc của màn này:
   1) Gỡ service worker + cache của app coach cũ (để domain này không phục vụ lại bản coach cũ lúc mất mạng).
   2) Hàng đợi lb_outbox còn sự kiện chưa gửi (set, số đo, mục tiêu, kết thúc buổi): nhập PIN → gửi lên máy chủ
      ĐÚNG như app coach (Worker trước, Worker từ chối / lỗi mạng thì Apps Script; máy chủ chống trùng theo id nên
      gửi lại an toàn). CHỈ gửi sự kiện của khách thật của người nhập PIN (lọc theo danh sách khách máy chủ trả về)
      — chặn dữ liệu chế độ ?demo lọt vào sheet thật. Sự kiện Admin đi adm_log với PIN Admin.
      PIN chỉ đi trong body POST tới máy chủ, không lưu lại ở đâu.
   3) Chỉ đường sang checkin.b0dy.studio. "Vào kiosk check-in" ẩn màn này cho lượt mở hiện tại. */
(function () {
  'use strict';
  var NEW_URL = 'https://checkin.b0dy.studio/';
  /* = hằng API / API_WK trong app.js của app coach (deployment "Coach API v1" + Worker b0dy-kiosk-api) */
  var API = 'https://script.google.com/macros/s/AKfycbyyCRs0JkV1k8npUpprP44RN-rgNnagWELRBwncBKAiiRKO6hNLDqFcnUrJz7hC_To41g/exec';
  var API_WK = 'https://b0dy-kiosk-api.little-bonus-1d87.workers.dev/';
  var WK_OFF = { wk_unconfigured: 1, wrong_ip: 1, unknown_action: 1, wk_no_sheet_coach: 1 };
  var BATCH = 150;

  var doc = document, html = doc.documentElement;
  function LS(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
    return null;
  }

  /* ---- 1) gỡ service worker + cache của app coach cũ (kiosk không dùng cả hai) ---- */
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
    }
  } catch (e) {}
  try {
    if (window.caches && caches.keys) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }).catch(function () {});
  } catch (e) {}

  /* ---- hàng đợi của app coach ---- */
  function queue() {
    var q = [];
    try { q = JSON.parse(LS('lb_outbox') || '[]'); } catch (e) { q = []; }
    if (!Array.isArray(q)) return [];
    return q.filter(function (e) { return e && typeof e === 'object' && e.id; });
  }
  function saveQueue(q) { LS('lb_outbox', q.length ? JSON.stringify(q) : null); }
  function dropIds(ids) {
    if (!ids.length) return;
    var gone = {}; ids.forEach(function (id) { gone[id] = 1; });
    saveQueue(queue().filter(function (e) { return !gone[e.id]; }));
  }
  function clean(e) { var o = {}; for (var k in e) if (k !== 'hold') o[k] = e[k]; return o; }

  /* ---- máy chủ: như api() của app coach ---- */
  function post(url, body, ms) {
    return new Promise(function (res, rej) {
      var c = window.AbortController ? new AbortController() : null;
      var t = setTimeout(function () { if (c) c.abort(); rej(new Error('timeout')); }, ms);
      fetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), signal: c ? c.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { clearTimeout(t); res(j); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  /* lệnh an toàn (coach · admin · log): Worker trước; Worker từ chối (WK_OFF) hoặc lỗi mạng → Apps Script */
  function call(body) {
    return post(API_WK, body, 15000)
      .then(function (r) { if (r && WK_OFF[r.error]) throw new Error('wk_off'); return r; })
      .catch(function () { var b = JSON.parse(JSON.stringify(body)); b._gas = 1; return post(API, b, 30000); });
  }
  function gas(body) { return post(API, body, 30000); }
  function nameSet(members) { var s = {}; (members || []).forEach(function (m) { if (m && m.name) s[String(m.name).trim()] = 1; }); return s; }

  /* PIN → ai: coach (Worker/Apps Script 'coach') hoặc Admin ('admin' rồi 'adm_data' để lấy danh sách khách toàn phòng) */
  function identify(pin) {
    return call({ action: 'coach', pin: pin }).then(function (r) {
      if (r && r.ok) return { mode: 'coach', who: String(r.coach || ''), names: nameSet(r.members) };
      if (!r || r.error !== 'sai_pin') throw new Error((r && r.error) || 'may_chu');
      return call({ action: 'admin', apin: pin }).then(function (a) {
        if (!a || !a.ok) { if (a && a.error === 'sai_pin') return { mode: null }; throw new Error((a && a.error) || 'may_chu'); }
        return gas({ action: 'adm_data', apin: pin }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || 'may_chu');
          return { mode: 'admin', who: 'Admin', names: nameSet(d.members) };
        });
      });
    });
  }
  function send(pin, mode, list) {
    var i = 0, sent = [];
    function next() {
      if (i >= list.length) return Promise.resolve(sent);
      var b = list.slice(i, i + BATCH); i += BATCH;
      var p = mode === 'admin'
        ? gas({ action: 'adm_log', apin: pin, events: b.map(clean) })
        : call({ action: 'log', pin: pin, events: b.map(clean) });
      return p.then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'may_chu');
        b.forEach(function (e) { sent.push(e.id); });
        dropIds(b.map(function (e) { return e.id; }));
        return next();
      });
    }
    return next();
  }

  /* ---- giao diện (brand B0DY: Ink / Paper / Acid, Switzer + JetBrains Mono weight 500) ---- */
  var CSS = '' +
    '#mv{position:fixed;inset:0;z-index:100;background:#0A0A0A;color:#FAFAFA;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
      'font-family:var(--sans,-apple-system,sans-serif);font-weight:500;-webkit-user-select:none;user-select:none}' +
    '#mv .in{min-height:100%;display:flex;flex-direction:column;max-width:480px;margin:0 auto;' +
      'padding:max(24px,env(safe-area-inset-top)) 20px max(24px,env(safe-area-inset-bottom))}' +
    '#mv .lab{font-family:var(--mono,Menlo,monospace);font-size:11px;line-height:13px;letter-spacing:.14em;text-transform:uppercase;color:#767676}' +
    '#mv .top{display:flex;justify-content:space-between;padding:8px 2px 16px;border-bottom:1px solid rgba(250,250,250,.14);margin-bottom:32px}' +
    '#mv h1{font-size:15px;line-height:19px;font-weight:500;color:#B0B0B0;margin:0 0 10px}' +
    '#mv .dom{font-size:34px;line-height:38px;letter-spacing:-.02em;word-break:break-all;margin:0 0 14px}' +
    '#mv .p{font-size:16px;line-height:22px;color:#B0B0B0;margin:0 0 28px}' +
    '#mv ol{list-style:none;margin:0 0 32px;padding:0;border-top:1px solid rgba(250,250,250,.14)}' +
    '#mv li{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid rgba(250,250,250,.14);font-size:16px;line-height:21px}' +
    '#mv li .lab{padding-top:4px;color:#767676}' +
    '#mv .pend{border:1px solid rgba(250,250,250,.14);border-radius:4px;padding:16px;margin:0 0 28px}' +
    '#mv .num{font-family:var(--mono,Menlo,monospace);font-size:40px;line-height:44px;color:#D4FF00;font-variant-numeric:tabular-nums;margin:8px 0 6px}' +
    '#mv .pend .p{margin:0 0 16px;font-size:15px;line-height:20px}' +
    '#mv input{display:block;width:100%;height:56px;border-radius:4px;border:1px solid rgba(250,250,250,.14);background:rgba(250,250,250,.06);' +
      'color:#FAFAFA;font-family:var(--mono,Menlo,monospace);font-size:24px;letter-spacing:.3em;text-align:center;outline:none;' +
      '-webkit-text-security:disc;-webkit-user-select:text;user-select:text;margin:0 0 12px;-webkit-appearance:none;appearance:none}' +
    '#mv input:focus{border-color:#FAFAFA}' +
    '#mv input::placeholder{color:#4A4A4A;letter-spacing:.14em;-webkit-text-security:none}' +
    '#mv .btn{display:flex;align-items:center;justify-content:center;width:100%;height:52px;border-radius:24px;border:0;' +
      'font-family:inherit;font-size:16px;font-weight:500;letter-spacing:-.01em;cursor:pointer;text-decoration:none;' +
      'transition:transform .1s ease-out;-webkit-appearance:none;appearance:none}' +
    '#mv .btn:active{transform:scale(.97)}' +
    '#mv .btn[disabled]{opacity:.5;pointer-events:none}' +
    '#mv .pri{background:#D4FF00;color:#0A0A0A}' +
    '#mv .gho{background:transparent;color:#FAFAFA;border:1px solid rgba(250,250,250,.3)}' +
    '#mv .msg{min-height:13px;margin:12px 0 0;color:#B0B0B0}' +
    '#mv .msg.err{color:#E92569}' +
    '#mv .skip{margin:14px 0 0}' +
    '#mv .foot{margin-top:auto;padding-top:28px;text-align:center}' +
    '#mv .link{background:none;border:0;color:#767676;font-family:var(--mono,Menlo,monospace);font-size:11px;letter-spacing:.14em;' +
      'text-transform:uppercase;text-decoration:underline;text-underline-offset:3px;padding:12px;cursor:pointer}' +
    '@media (prefers-reduced-motion:reduce){#mv .btn{transition:none}}';

  var root, ui = {}, armed = 0;
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build() {
    var st = el('style'); st.textContent = CSS; doc.head.appendChild(st);
    root = el('div'); root.id = 'mv';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'App coach đã chuyển sang checkin.b0dy.studio');
    var inn = el('div', 'in'); root.appendChild(inn);

    var top = el('div', 'top lab'); top.appendChild(el('span', '', 'B0DY — App coach')); top.appendChild(el('span', '', 'Đã chuyển'));
    inn.appendChild(top);
    inn.appendChild(el('h1', '', 'App coach nay ở địa chỉ mới'));
    inn.appendChild(el('div', 'dom', 'checkin.b0dy.studio'));
    inn.appendChild(el('p', 'p', 'Địa chỉ cũ này (demo.b0dy.studio) giờ là kiosk check-in cho khách.'));

    /* khối chưa gửi — chỉ hiện khi hàng đợi còn sự kiện */
    var pend = ui.pend = el('div', 'pend');
    pend.appendChild(el('div', 'lab', 'Chưa gửi lên máy chủ'));
    ui.num = el('div', 'num', '0'); pend.appendChild(ui.num);
    pend.appendChild(el('p', 'p', 'thao tác ghi trên máy này (set, số đo, mục tiêu, kết thúc buổi). Gửi trước khi chuyển — nhập PIN của bạn:'));
    var inp = ui.pin = el('input');
    inp.type = 'text'; inp.setAttribute('inputmode', 'numeric'); inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocorrect', 'off'); inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('spellcheck', 'false');
    inp.setAttribute('aria-label', 'PIN'); inp.placeholder = 'PIN'; inp.maxLength = 8;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    pend.appendChild(inp);
    ui.send = el('button', 'btn pri', 'Gửi'); ui.send.type = 'button'; ui.send.addEventListener('click', submit);
    pend.appendChild(ui.send);
    ui.msg = el('div', 'msg lab'); pend.appendChild(ui.msg);
    ui.skip = el('button', 'btn gho skip'); ui.skip.type = 'button'; ui.skip.addEventListener('click', skipLeft);
    pend.appendChild(ui.skip);
    inn.appendChild(pend);

    var ol = el('ol');
    [['01', 'Mở Safari, vào checkin.b0dy.studio'],
     ['02', 'Chạm Chia sẻ → Thêm vào MH chính'],
     ['03', 'Đăng nhập bằng PIN như cũ, rồi xoá biểu tượng cũ này']].forEach(function (s) {
      var li = el('li'); li.appendChild(el('span', 'lab', s[0])); li.appendChild(el('span', '', s[1])); ol.appendChild(li);
    });
    inn.appendChild(ol);

    ui.open = el('a', 'btn pri', 'Mở checkin.b0dy.studio'); ui.open.href = NEW_URL; ui.open.rel = 'noopener';
    inn.appendChild(ui.open);

    var foot = el('div', 'foot');
    var k = el('button', 'link', 'Vào kiosk check-in'); k.type = 'button'; k.addEventListener('click', toKiosk);
    foot.appendChild(k); inn.appendChild(foot);

    doc.body.appendChild(root);
    render();
  }

  var last = null;   /* kết quả nhận diện PIN gần nhất: {mode, who, names} */
  function split() {
    var q = queue(), mode = last && last.mode, names = last && last.names;
    var mine = q.filter(function (e) { return mode === 'admin' ? e.coach === 'Admin' : e.coach !== 'Admin'; });
    var off = mode ? mine.filter(function (e) { return !names[String(e.name || '').trim()]; }) : [];
    return { q: q, mine: mine, off: off };
  }
  function render() {
    var s = split(), n = s.q.length;
    ui.pend.style.display = n ? '' : 'none';
    ui.num.textContent = String(n);
    ui.send.textContent = n === 1 ? 'Gửi 1 thao tác' : 'Gửi ' + n + ' thao tác';
    ui.open.className = 'btn ' + (n ? 'gho' : 'pri');
    ui.skip.style.display = s.off.length ? '' : 'none';
    if (s.off.length && !armed) ui.skip.textContent = 'Bỏ ' + s.off.length + ' thao tác không khớp khách';
  }
  function say(t, err) { ui.msg.textContent = t || ''; ui.msg.className = 'msg lab' + (err ? ' err' : ''); }
  function busy(on) { ui.send.disabled = !!on; ui.pin.disabled = !!on; if (on) ui.send.textContent = 'Đang gửi…'; }

  function submit() {
    var pin = String(ui.pin.value || '').replace(/\s+/g, '');
    if (!pin) { say('Nhập PIN', true); ui.pin.focus(); return; }
    if (ui.send.disabled) return;
    busy(true); say('');
    identify(pin).then(function (id) {
      if (!id.mode) { busy(false); render(); ui.pin.value = ''; say('Sai PIN', true); return; }
      last = id;
      var s = split();
      var go = s.mine.filter(function (e) { return id.names[String(e.name || '').trim()]; });
      if (!go.length) {
        busy(false); render();
        say(s.mine.length ? 'Không có thao tác nào khớp khách của ' + id.who : 'Không có thao tác nào của ' + id.who, true);
        return;
      }
      return send(pin, id.mode, go).then(function (sent) {
        busy(false); ui.pin.value = ''; armed = 0; render();
        var left = queue().length;
        say('Đã gửi ' + sent.length + ' thao tác' + (left ? ' — còn ' + left : ''), false);
      });
    }).catch(function (e) {
      busy(false); render();
      var m = String(e && e.message || '');
      say(/abort|timeout|fetch|network|load/i.test(m) ? 'Mất mạng — thử lại' : 'Máy chủ báo lỗi — thử lại', true);
    });
  }
  /* bỏ những thao tác không thuộc khách của người vừa nhập PIN (dữ liệu thử) — chạm hai lần, không dùng hộp thoại */
  function skipLeft() {
    var s = split();
    if (!s.off.length) return;
    if (!armed) { armed = 1; ui.skip.textContent = 'Chạm lần nữa để bỏ ' + s.off.length + ' thao tác'; setTimeout(function () { if (armed) { armed = 0; render(); } }, 4000); return; }
    armed = 0;
    dropIds(s.off.map(function (e) { return e.id; }));
    render(); say('Đã bỏ ' + s.off.length + ' thao tác', false);
  }
  function toKiosk() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    html.className = html.className.replace(/\s*\bmoved\b/g, '');
  }

  if (doc.body) build(); else doc.addEventListener('DOMContentLoaded', build);
  window.__moved = { queue: queue, split: split, render: render };   /* cho test */
})();
