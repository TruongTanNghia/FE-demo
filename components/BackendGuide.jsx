"use client";

import { useState } from "react";

/** Hop thoai ket noi backend: URL + token + huong dan Vercel <-> may ca nhan. */
export default function BackendGuide({ url, token, online, status, onSave, onClose }) {
  const [u, setU] = useState(url);
  const [t, setT] = useState(token);

  const isHttpsPage = typeof window !== "undefined" && window.location.protocol === "https:";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u);
  const mixed = isHttpsPage && /^http:\/\//i.test(u) && !isLocal;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Kết nối backend trên máy cá nhân</h3>

        <div className="field wide">
          <span>Địa chỉ backend</span>
          <input
            type="text"
            value={u}
            onChange={(e) => setU(e.target.value)}
            placeholder="http://localhost:8000 hoặc https://xxxx.trycloudflare.com"
            style={inputStyle}
          />
        </div>
        <div className="field wide">
          <span>Token (khớp API_TOKEN trong run_backend.bat — để trống nếu backend không bật)</span>
          <input type="text" value={t} onChange={(e) => setT(e.target.value)} style={inputStyle} />
        </div>

        <p style={{ color: online ? "var(--green)" : "var(--red)" }}>
          {online ? `● Đang kết nối · ${status?.device}` : "● Chưa kết nối được"}
        </p>
        {mixed && (
          <p style={{ color: "var(--amber)" }}>
            ⚠ Trang này chạy HTTPS (Vercel) nhưng backend là <code>http://</code> ở máy khác — trình duyệt sẽ chặn. Dùng
            Cloudflare Tunnel (cách 2) để có địa chỉ <code>https://</code>, hoặc mở web-app ngay trên máy chạy backend và dùng{" "}
            <code>http://localhost:8000</code>.
          </p>
        )}

        <p><b>Cách 1 — cùng máy</b> (đơn giản nhất): trên máy chạy backend, mở trang Vercel này và dùng <code>http://localhost:8000</code>. Trình duyệt cho phép trang HTTPS gọi <code>localhost</code>.</p>
        <ol>
          <li>Chạy <code>webapp\backend\run_backend.bat</code> (sửa <code>API_TOKEN</code> trong file trước).</li>
          <li>Nhập <code>http://localhost:8000</code> + token ở trên → Lưu.</li>
        </ol>

        <p><b>Cách 2 — máy khác / điện thoại / khách xem demo</b>: mở backend ra internet bằng <b>ngrok</b> hoặc Cloudflare Tunnel (miễn phí, không cần mở port router).</p>
        <ol>
          <li>ngrok: tải <code>ngrok.exe</code> (ngrok.com/download), chạy <code>ngrok config add-authtoken ...</code> 1 lần, rồi <code>run_tunnel_ngrok.bat</code> → copy dòng <code>Forwarding https://xxxx.ngrok-free.app</code>.<br />
            Cloudflare: tải <code>cloudflared.exe</code>, chạy <code>run_tunnel.bat</code> → copy <code>https://xxxx.trycloudflare.com</code>.</li>
          <li>Dán vào ô địa chỉ ở trên + token → Lưu. (App tự gửi header bỏ qua trang cảnh báo của ngrok free.)</li>
          <li>Chia sẻ cho người khác bằng link: <code>{typeof window !== "undefined" ? window.location.origin : ""}/?backend=https://xxxx.ngrok-free.app&amp;token=...</code></li>
        </ol>
        <p style={{ fontSize: 12 }}>
          Mặc định khi deploy đặt trong Vercel → Environment Variables: <code>NEXT_PUBLIC_BACKEND_URL</code>, <code>NEXT_PUBLIC_BACKEND_TOKEN</code>. Camera RTSP được backend đọc trực tiếp, mật khẩu camera không bao giờ rời khỏi máy anh.
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={onClose}>Đóng</button>
          <button className="btn primary" onClick={() => onSave(u.trim().replace(/\/$/, ""), t.trim())}>Lưu &amp; kết nối</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line-2)",
  borderRadius: 5,
  padding: "7px 10px",
  color: "var(--text)",
  width: "100%",
  fontFamily: "var(--font-mono)",
};
