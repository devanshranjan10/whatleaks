#!/bin/sh
# The lab benchmark on Linux, in Docker. Builds the image (runtimes and dependencies only),
# then runs bench/run-lab.ts inside it against this checkout's dist/ and bench/.
# Results land in bench/results/lab-<tag>.json. Extra arguments go to run-lab.ts.
#
#   npm run build && bench/linux/lab.sh --tag linux --tools whatleaks,mitmproxy,httptoolkit
set -e
repo=$(cd "$(dirname "$0")/../.." && pwd)
ctx=$(mktemp -d)
trap 'rm -rf "$ctx"' EXIT
cp "$repo/package.json" "$repo/package-lock.json" "$repo/bench/linux/Dockerfile" "$ctx/"
arch=$(docker info --format '{{.Architecture}}' | sed 's/aarch64/arm64/; s/x86_64/amd64/')
(cd "$repo/bench/lab/clients/go" && GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build -o "$ctx/go-client" .)
docker build -q -t whatleaks-lab:linux "$ctx"
mkdir -p "${WLB:-/tmp/wlb}/linux-runs"
exec docker run --rm \
  -v "$repo/src:/app/src:ro" -v "$repo/dist:/app/dist:ro" -v "$repo/tsconfig.json:/app/tsconfig.json:ro" \
  -v "$repo/bench:/app/bench" -v "${WLB:-/tmp/wlb}/linux-runs:/wlb/lab-runs" \
  whatleaks-lab:linux npx tsx bench/run-lab.ts "$@"
