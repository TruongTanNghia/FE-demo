@echo off
REM Chay backend Traffic Monitor tren may ca nhan (GPU neu co).
REM Sua API_TOKEN thanh chuoi bi mat cua anh (dung cung token nay trong web-app).
cd /d "%~dp0"

set API_TOKEN=demo-token-doi-cai-nay
set STREAM_WIDTH=960
set JPEG_QUALITY=60
set STREAM_FPS=10
set PORT=8000

if exist "..\..\venv311\Scripts\python.exe" (
  set PY=..\..\venv311\Scripts\python.exe
) else (
  set PY=python
)

echo [run_backend] python=%PY%  port=%PORT%  token=%API_TOKEN%
%PY% server.py
pause
