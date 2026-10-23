#!/bin/sh
# Tells IndexNow search engines (Bing, Yandex, Seznam, Naver; Bing feeds ChatGPT search and Copilot) that
# whatleaks.me changed. Run after `npm run site:deploy`. The key file is site/<key>.txt.
set -e
cd "$(dirname "$0")/../.."
KEY=$(basename "$(ls site/*.txt | grep -E '/[0-9a-f]{32}\.txt$' | head -1)" .txt)
URLS='"https://whatleaks.me/","https://whatleaks.me/docs/","https://whatleaks.me/benchmark/","https://whatleaks.me/faq/","https://whatleaks.me/llms.txt","https://whatleaks.me/llms-full.txt"'
curl -s -o /dev/null -w 'IndexNow: HTTP %{http_code}\n' -X POST https://api.indexnow.org/indexnow \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"whatleaks.me\",\"key\":\"$KEY\",\"keyLocation\":\"https://whatleaks.me/$KEY.txt\",\"urlList\":[$URLS]}"
