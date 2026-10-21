"""Lab client for Python. Usage: python py-client.py <urllib|requests|httpx|aiohttp>.

Every attempt is written to LAB_LEDGER before it is made. aiohttp ignores proxy
variables unless trust_env=True (its default is False), so it is a direct client: it is
given the lab CA so its request succeeds, as a real vendor's certificate would.
"""
import hashlib, json, os, ssl, sys, time

E = os.environ
lib = sys.argv[1] if len(sys.argv) > 1 else "urllib"
seq0 = int(E.get("LAB_SEQ0", "0"))


def path(seq):
    return f"/e/{E['LAB_SC']}/{E['LAB_RUN']}/{seq}"


def url(seq, port=None):
    return f"https://{E['LAB_HOST']}:{port or E['LAB_PORT']}{path(seq)}"


def body(seq):
    return json.dumps({"sc": E["LAB_SC"], "run": int(E["LAB_RUN"]), "seq": seq, "pad": "x" * 64}, separators=(",", ":"))


def ledger(seq, b, **extra):
    with open(E["LAB_LEDGER"], "a") as f:
        f.write(json.dumps({"sc": E["LAB_SC"], "run": int(E["LAB_RUN"]), "t": int(time.time() * 1000), "pid": os.getpid(), "seq": seq,
                            "kind": "http", "path": path(seq), "port": int(extra.pop("port", E["LAB_PORT"])),
                            "bodySha": hashlib.sha256(b.encode()).hexdigest(), "bodyLen": len(b.encode()), **extra}) + "\n")


def run():
    for i in range(3):
        seq = seq0 + i
        b = body(seq)
        try:
            if lib == "urllib":
                import urllib.request
                ledger(seq, b)
                urllib.request.urlopen(urllib.request.Request(url(seq), data=b.encode(), method="POST", headers={"content-type": "application/json"})).read()
            elif lib == "requests":
                import requests
                ledger(seq, b)
                requests.post(url(seq), data=b, headers={"content-type": "application/json"})
            elif lib == "httpx":
                import httpx
                ledger(seq, b)
                httpx.post(url(seq), content=b, headers={"content-type": "application/json"})
            elif lib == "aiohttp":
                import asyncio, aiohttp
                ledger(seq, b, direct=True)

                async def go():
                    # The lab's CA (standing in for public roots), plus any CA the
                    # environment configures, as a default context would load it.
                    ctx = ssl.create_default_context(cafile=E["LAB_CA"])
                    if E.get("SSL_CERT_FILE"):
                        ctx.load_verify_locations(cafile=E["SSL_CERT_FILE"])
                    async with aiohttp.ClientSession() as s:
                        async with s.post(url(seq), data=b, ssl=ctx) as r:
                            await r.read()
                asyncio.run(go())
        except Exception as e:  # the ledger already has the attempt
            print(f"{lib} {seq}: {type(e).__name__}: {e}", file=sys.stderr)


run()
