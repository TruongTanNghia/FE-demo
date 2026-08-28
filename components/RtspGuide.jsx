"use client";

const RELAY_URL = "http://localhost:1984/api/stream.mp4?src=cam1";

export default function RtspGuide({ onClose, onUse }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Camera RTSP → trình duyệt</h3>
        <p>
          Trình duyệt <b>không phát được RTSP trực tiếp</b> (không có backend nào trên Vercel làm được việc này). Cách chuẩn: chạy
          một relay nhỏ ngay trên máy có mạng với camera — <code>go2rtc</code> (1 file chạy, không cần code) — nó chuyển RTSP thành
          MP4/HLS/WebRTC, web-app này chỉ cần trỏ vào URL đó.
        </p>
        <ol>
          <li>
            Tải <code>go2rtc</code> tại <code>github.com/AlexxIT/go2rtc/releases</code> (Windows: <code>go2rtc_win64.zip</code>).
          </li>
          <li>
            Trong thư mục <code>webapp/rtsp-relay/</code> có sẵn <code>go2rtc.example.yaml</code> — copy thành <code>go2rtc.yaml</code>,
            điền link RTSP của camera:
            <pre>{`streams:
  cam1: rtsp://USER:PASS@IP:554/h264/ch1/main/av_stream
api:
  listen: ":1984"
  origin: "*"`}</pre>
          </li>
          <li>
            Chạy <code>go2rtc.exe</code> trong thư mục đó. Mở <code>http://localhost:1984</code> để kiểm tra camera lên hình.
          </li>
          <li>
            Dán URL sau vào ô stream và bấm Kết nối:
            <pre>{RELAY_URL}</pre>
            (hoặc HLS: <code>http://localhost:1984/api/stream.m3u8?src=cam1</code>)
          </li>
        </ol>
        <p style={{ fontSize: 12 }}>
          ⚠ Trang deploy trên Vercel là HTTPS; Chrome/Edge vẫn cho phép nạp <code>http://localhost</code> nên chạy relay ngay trên
          máy xem là được. Nếu relay đặt ở máy khác, hãy bật HTTPS cho go2rtc hoặc mở web-app bằng <code>npm run dev</code> (HTTP).
          Mật khẩu camera chỉ nằm trong file yaml trên máy anh — không bao giờ đưa lên web.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={onClose}>Đóng</button>
          <button className="btn primary" onClick={() => onUse(RELAY_URL)}>Dùng URL relay mặc định</button>
        </div>
      </div>
    </div>
  );
}
