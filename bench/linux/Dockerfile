# Linux lab image: the same benchmark on Debian 12 with Node 26, plus Node 22 and 20,
# curl, Python (requests, httpx, aiohttp), OpenJDK, a Go client, mitmproxy (through uv)
# and the HTTP Toolkit server. Built by bench/linux/lab.sh; whatleaks' sources are
# mounted at run time, so the image holds only runtimes and dependencies.
FROM node:26-bookworm-slim

ARG NODE22=v22.23.4
ARG NODE20=v20.20.2
ARG HTK=v1.27.3

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-venv openjdk-17-jdk-headless xz-utils bash \
 && rm -rf /var/lib/apt/lists/*

# Older Node releases, as their official tarballs.
RUN set -e; arch=$(dpkg --print-architecture | sed 's/amd64/x64/'); \
    for v in $NODE22 $NODE20; do \
      curl -fsSL "https://nodejs.org/dist/$v/node-$v-linux-$arch.tar.xz" | tar -xJ -C /opt; \
      ln -s "/opt/node-$v-linux-$arch" "/opt/node-${v%%.*}"; \
    done

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /uvx /usr/local/bin/
ENV WLB=/wlb WLB_NODE22=/opt/node-v22/bin/node WLB_NODE20=/opt/node-v20/bin/node
RUN uv venv -q -p python3 /wlb/venv \
 && uv pip install -q -p /wlb/venv/bin/python 'requests==2.*' 'httpx==0.*' 'aiohttp==3.*' \
 && uvx --from 'mitmproxy==12.*' mitmdump --version | head -1 > /wlb/mitmproxy-version.txt

RUN set -e; arch=$(dpkg --print-architecture | sed 's/amd64/x64/'); mkdir -p /wlb/httptoolkit/dl; \
    curl -fsSL "https://github.com/httptoolkit/httptoolkit-server/releases/download/$HTK/httptoolkit-server-$HTK-linux-$arch.tar.gz" | tar -xz -C /wlb/httptoolkit/dl

COPY go-client /wlb/bin/go-client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
