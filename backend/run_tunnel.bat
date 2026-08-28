@echo off
REM Mo backend ra internet bang Cloudflare Tunnel (mien phi, khong can mo port router).
REM Tai cloudflared.exe: https://github.com/cloudflare/cloudflared/releases  (cloudflared-windows-amd64.exe -> doi ten cloudflared.exe)
REM dat cung thu muc nay hoac trong PATH. Chay sau khi run_backend.bat da len.
cd /d "%~dp0"

set PORT=8000
if exist cloudflared.exe (set CF=cloudflared.exe) else (set CF=cloudflared)

echo [tunnel] Dang mo tunnel toi http://localhost:%PORT% ...
echo [tunnel] Copy dong "https://xxxx.trycloudflare.com" ben duoi, dan vao o "Backend" cua web-app.
%CF% tunnel --url http://localhost:%PORT% --no-autoupdate
pause
