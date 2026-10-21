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
# HTTP Toolkit baseline: the official server release, pinned, with a private config folder.
HTK=v1.27.3
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) htk_platform=darwin-arm64 ;; Darwin-x86_64) htk_platform=darwin-x64 ;;
  Linux-aarch64) htk_platform=linux-arm64 ;; *) htk_platform=linux-x64 ;;
esac
if [ ! -x "$WLB/httptoolkit/dl/httptoolkit-server/bin/httptoolkit-server" ]; then
  mkdir -p "$WLB/httptoolkit/dl"
  (cd "$WLB/httptoolkit/dl" && gh release download "$HTK" -R httptoolkit/httptoolkit-server -p "httptoolkit-server-$HTK-$htk_platform.tar.gz" && tar -xzf "httptoolkit-server-$HTK-$htk_platform.tar.gz")
fi
echo "setup done in $WLB"
