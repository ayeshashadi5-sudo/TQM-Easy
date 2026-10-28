#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ثبّتي Node.js من https://nodejs.org"; exit 1; }
CF=$(command -v cloudflared || echo ./cloudflared)
[ -x "$CF" ] || { echo "ثبّتي cloudflared: https://github.com/cloudflare/cloudflared/releases/latest"; exit 1; }
TRUST_PROXY=1 node server.js &
SRV=$!
sleep 2
echo "ابحثي عن رابط ينتهي بـ trycloudflare.com وأرسليه للفريق (يتغير كل مرة)"
"$CF" tunnel --url http://localhost:3000
kill $SRV
