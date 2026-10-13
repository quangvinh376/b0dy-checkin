/* demo.b0dy.studio — từ 13/10/2026 là kiosk check-in (kiosk không dùng service worker).
   Máy từng cài app coach ở domain này còn service worker cũ đăng ký ở /sw.js. Khi trình duyệt kiểm tra cập nhật,
   nó nhận bản này: cài ngay, xoá mọi cache, tự gỡ đăng ký. Không có handler 'fetch' → mọi request đi thẳng mạng.
   Không xoá file này: máy coach nào lâu chưa mở biểu tượng cũ vẫn cần nó để dọn. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
      .catch(function () {})
      .then(function () { return self.registration.unregister(); })
  );
});
