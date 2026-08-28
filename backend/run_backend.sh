#!/usr/bin/env bash
# Chay backend tren Linux/Mac. Doi API_TOKEN thanh chuoi bi mat cua ban.
cd "$(dirname "$0")"
export API_TOKEN="${API_TOKEN:-demo-token-doi-cai-nay}"
export STREAM_WIDTH="${STREAM_WIDTH:-1280}"
export JPEG_QUALITY="${JPEG_QUALITY:-75}"
export PORT="${PORT:-8000}"
PY=python
[ -x ../../venv311/bin/python ] && PY=../../venv311/bin/python
exec "$PY" server.py
