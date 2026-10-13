# b0dy-checkin

Kiosk check-in của B0DY Studio (khách tự check-in, coach ký PIN) — **https://demo.b0dy.studio** từ 13/10/2026 (trước đó ở checkin.b0dy.studio). Đã ngừng phát triển; app chính cho coach là `quangvinh376/b0dy-coach` ở **https://checkin.b0dy.studio**.

- `index.html` — toàn bộ kiosk (v20). Máy chủ: Worker `b0dy-kiosk-api` trước, lui về Apps Script (deployment kiosk) — không phụ thuộc domain.
- `moved.js` — chỉ nạp trên máy còn dữ liệu app coach (khoá `lb_*` trong localStorage của domain này, tức máy coach mở biểu tượng app coach cũ): ẩn kiosk, chỉ đường sang checkin.b0dy.studio, gửi nốt hàng đợi `lb_outbox` chưa gửi bằng PIN (chỉ sự kiện của khách thật của người nhập PIN), gỡ service worker + cache cũ. Máy kiosk không bao giờ thấy màn này.
- `sw.js` — bản tự gỡ cho service worker cũ của app coach (đăng ký ở `/sw.js`). Kiosk không đăng ký service worker. Đừng xoá file này.
