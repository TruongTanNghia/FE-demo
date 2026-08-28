@echo off
REM !!! CANH BAO: ngrok FREE chi cho 1 GB/thang -> luong video ~1 MB/s can sau ~15 phut (loi ERR_NGROK_725).
REM !!! De demo video hay dung run_tunnel.bat (Cloudflare Tunnel, khong gioi han bang thong).
REM Mo backend ra internet bang ngrok (chi hop khi co goi tra phi).
REM 1) Tai ngrok: https://ngrok.com/download  -> ngrok.exe (dat canh file nay hoac trong PATH)
REM 2) Dang nhap 1 lan:  ngrok config add-authtoken <token tren dashboard ngrok>
REM 3) Chay run_backend.bat truoc, roi chay file nay.
REM    Copy dong "Forwarding https://xxxx.ngrok-free.app" dan vao o Backend cua web-app.
REM
REM Mien phi co 1 domain co dinh: tao tren dashboard (Domains) roi dung:
REM    ngrok http --url=ten-cua-anh.ngrok-free.app 8000
cd /d "%~dp0"
set PORT=8000
if exist ngrok.exe (set NG=ngrok.exe) else (set NG=ngrok)
%NG% http %PORT%
pause
