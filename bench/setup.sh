#!/bin/sh
# One-time setup for the benchmark. Everything goes under $WLB (default /tmp/wlb);
# nothing is installed system-wide.
set -e
WLB=${WLB:-/tmp/wlb}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$WLB/bin"
# Go client.
(cd "$here/lab/clients/go" && go build -o "$WLB/bin/go-client" .)
# Python libraries for the requests / httpx / aiohttp scenarios.
[ -x "$WLB/venv/bin/python" ] || uv venv -q -p 3.14 "$WLB/venv"
uv pip install -q -p "$WLB/venv/bin/python" 'requests==2.*' 'httpx==0.*' 'aiohttp==3.*'
# mitmproxy baseline, isolated config dir (never ~/.mitmproxy).
uvx --from 'mitmproxy==12.*' mitmdump --version > "$WLB/mitmproxy-version.txt" 2>&1 || true
head -1 "$WLB/mitmproxy-version.txt"
echo "setup done in $WLB"
