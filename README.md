# Traffic Monitor Web — Bài 9 chạy 100% trong trình duyệt

Toàn bộ pipeline của Bài 9 (detect → track → đếm qua vạch → vùng polygon → đo tốc độ → chụp xe vi phạm) chạy **ngay trên trình duyệt** bằng YOLOv8n + ONNX Runtime Web (WebGPU, fallback WASM). **Không có backend** — deploy thẳng lên Vercel như một site tĩnh.

## Tính năng

| Tính năng | Bài học | Cách dùng |
|---|---|---|
| Phát hiện + phân loại 4 loại xe | Bài 1, 3 | Tự động |
| Tracking ID + vệt quỹ đạo | Bài 5 | Tự động (ByteTrack-lite viết bằng JS) |
| Đếm xe 2 chiều qua vạch, chi tiết theo loại | Bài 6 | **Vẽ vạch đếm** → click 2 điểm |
| Vùng polygon + cảnh báo dừng lâu | Bài 7 | **Vẽ vùng** → click các đỉnh → Enter |
| Đo tốc độ km/h + cảnh báo + **chụp hình xe vi phạm** | Bài 8 | Nhập kích thước thật → **Phối cảnh** → click 4 góc |
| Báo cáo JSON, tải ảnh vi phạm | Bài 9 | Nút ở thanh dưới / panel phải |
| Nguồn: file, video mẫu, webcam, HLS/MP4 stream, camera RTSP (qua relay) | Bài 9.6 | Thanh trên |

Cấu hình vạch/vùng/phối cảnh được lưu `localStorage`, mở lại video là còn.

## Hai chế độ chạy (nút chuyển ở góc trên trái)

| | 🌐 Trình duyệt | ⚡ Backend GPU |
|---|---|---|
| Xử lý ở đâu | Ngay trong trình duyệt (ONNX Runtime Web) | Python trên máy anh (ultralytics + supervision) |
| Tốc độ | WebGPU: tốt · WASM (không có WebGPU): ~2 fps | GPU NVIDIA: 30+ fps · CPU: 1–3 fps |
| RTSP | Cần relay go2rtc | **Đọc trực tiếp** bằng OpenCV, dán link rtsp:// là chạy |
| Deploy | Vercel (tĩnh) | Backend chạy local, UI vẫn mở từ Vercel được |

### Backend GPU local

```bash
cd webapp/backend
pip install -r requirements.txt
# GPU NVIDIA (làm 1 lần): pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
python server.py                # http://localhost:8000
```

Mở web-app → bấm **⚡ Backend GPU** → dán `rtsp://user:pass@ip:554/h264/ch1/main/av_stream` (mật khẩu có `$` thì viết `%24`) → Kết nối. Vẽ vạch/vùng/phối cảnh bằng chuột y như chế độ trình duyệt; ảnh xe vi phạm lưu thêm ở `backend/violations/`. API: `GET /api/status`, `POST /api/source`, `POST /api/config`, `POST /api/upload`, `GET /api/report`, `GET /stream.mjpg`, `WS /ws`.

## Chạy local (frontend)

```bash
cd webapp
npm install          # tự copy runtime WASM vào public/ort
npm run dev          # http://localhost:3000
```

Model `public/models/yolov8n.onnx` được xuất từ `yolov8n.pt`:

```bash
yolo export model=yolov8n.pt format=onnx imgsz=640 opset=12 simplify=True
```

## Deploy Vercel + backend trên máy cá nhân

```
┌──────────────── Vercel (HTTPS, tĩnh) ────────────────┐
│  Next.js UI: vẽ vạch/vùng bằng chuột, thống kê, ảnh   │
└───────────────┬──────────────────────────────────────┘
                │ fetch /api/*  ·  <img> /stream.mjpg  ·  WebSocket /ws   (+ ?token=)
   ┌────────────┴───────────────┐        ┌───────────────────────────────┐
   │ Cách 1: http://localhost   │        │ Cách 2: Cloudflare Tunnel     │
   │ (mở UI ngay trên máy chạy  │        │ https://xxxx.trycloudflare.com│
   │ backend — trình duyệt cho  │        │ (máy khác / điện thoại / demo)│
   │ phép HTTPS → localhost)    │        │                               │
   └────────────┬───────────────┘        └──────────────┬────────────────┘
                └──────────────┬───────────────────────┘
                 ┌─────────────┴──────────────┐
                 │  Máy cá nhân (GPU)          │
                 │  backend/server.py :8000    │──► camera RTSP / file / webcam
                 └─────────────────────────────┘
```

**Deploy UI:** import repo trên vercel.com → **Root Directory = `webapp`** → (tùy chọn) Environment Variables `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_BACKEND_TOKEN` (xem `.env.example`) → Deploy.

**Chạy backend trên máy anh:**
1. Sửa `API_TOKEN` trong `backend/run_backend.bat` thành chuỗi bí mật, chạy file đó (GPU tự bật nếu có torch CUDA).
2. Mở trang Vercel → **⚡ Backend GPU** → **🔗 Backend** → nhập `http://localhost:8000` + token → Lưu.
3. Muốn xem từ máy khác: **Cloudflare Tunnel** (`run_tunnel.bat`, không giới hạn băng thông) → dán URL `https://xxxx.trycloudflare.com` vào ô Backend. Chia sẻ cho người khác bằng link `https://<app>.vercel.app/?engine=backend&backend=https://xxxx.trycloudflare.com&token=...`.
   ⚠ **ngrok free chỉ cho 1 GB/tháng** — luồng video cạn sau ~15 phút rồi trả `403 ERR_NGROK_725` (màn hình đen). Chỉ dùng ngrok khi có gói trả phí.

Mọi dữ liệu (API, MJPEG, thống kê) đều đi qua `fetch()` có header `X-Token` + `ngrok-skip-browser-warning`, nên chạy được qua ngrok free (không dính trang "Visit Site"), Cloudflare, hay localhost. Backend bật token thì request không có token đúng bị 401 — an toàn khi mở ra internet. Biến môi trường backend: `API_TOKEN`, `PORT`, `STREAM_WIDTH` (1280), `JPEG_QUALITY` (75), `IMGSZ` (640).

## Camera RTSP

Trình duyệt không phát RTSP. Chạy [go2rtc](https://github.com/AlexxIT/go2rtc/releases) trên máy có mạng với camera, cấu hình theo `rtsp-relay/go2rtc.example.yaml`, rồi dán `http://localhost:1984/api/stream.mp4?src=cam1` vào ô stream. Bấm nút **RTSP?** trong app để xem hướng dẫn chi tiết.

## Cấu trúc

```
webapp/
├── app/               layout, page, globals.css
├── components/
│   ├── TrafficMonitor.jsx   stage video + canvas overlay, vòng lặp xử lý, công cụ vẽ
│   ├── SidePanel.jsx        thống kê, vùng, tốc độ, vi phạm, thiết lập
│   └── RtspGuide.jsx        hướng dẫn relay RTSP
├── lib/
│   ├── detector.js    YOLOv8 ONNX: letterbox → inference → decode → NMS
│   ├── tracker.js     ByteTrack-lite (2 vòng IoU, lost buffer, smoothing)
│   ├── geometry.js    IoU, side-of-line, point-in-polygon, homography 8x8
│   ├── monitor.js     TrafficMonitor: LineZone, PolygonZone, speed, violations
│   └── draw.js        các "annotator" vẽ lên canvas
├── public/models/yolov8n.onnx
├── rtsp-relay/go2rtc.example.yaml
└── scripts/copy-ort.mjs
```

## Phím tắt

`Space` chạy/dừng · `L` vẽ vạch · `Z` vẽ vùng · `P` phối cảnh · `Enter` đóng vùng · `Esc` hủy
