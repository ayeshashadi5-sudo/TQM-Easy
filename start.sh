#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ثبّتي Node.js من https://nodejs.org"; exit 1; }
node server.js
