@echo off
set HTTP_PROXY=http://127.0.0.1:7897
set HTTPS_PROXY=http://127.0.0.1:7897
set ALL_PROXY=http://127.0.0.1:7897
echo Starting Cloudflare Tunnel...
cloudflared.exe tunnel --url http://localhost:3000
