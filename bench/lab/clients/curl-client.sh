#!/bin/sh
# Lab client for curl. Usage: curl-client.sh [--http2]
seq0=${LAB_SEQ0:-0}
for i in 0 1 2; do
  seq=$((seq0 + i))
  path="/e/$LAB_SC/$LAB_RUN/$seq"
  body="{\"sc\":\"$LAB_SC\",\"run\":$LAB_RUN,\"seq\":$seq,\"pad\":\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"}"
  sha=$(printf '%s' "$body" | shasum -a 256 | cut -d' ' -f1)
  len=$(printf '%s' "$body" | wc -c | tr -d ' ')
  printf '{"sc":"%s","run":%s,"t":%s,"pid":%s,"seq":%s,"kind":"http","path":"%s","port":%s,"bodySha":"%s","bodyLen":%s}\n' \
    "$LAB_SC" "$LAB_RUN" "$(($(date +%s) * 1000))" "$$" "$seq" "$path" "$LAB_PORT" "$sha" "$len" >> "$LAB_LEDGER"
  curl -s -o /dev/null $1 -H 'content-type: application/json' --data-binary "$body" "https://$LAB_HOST:$LAB_PORT$path" || echo "curl $seq failed" >&2
done
