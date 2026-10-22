# whatleaks Python hook (on PYTHONPATH inside a whatleaks run only).
#
# Two things the environment variables alone do not reach:
# - Pythons whose ssl module ignores SSL_CERT_FILE (Apple's /usr/bin/python3, built on
#   LibreSSL) refuse the run's CA. Default contexts made here also trust it: the same
#   trust SSL_CERT_FILE gives every other Python, and only in this process tree. A context
#   given its own cafile, capath or cadata (pinning) is left alone.
# - aiohttp ignores proxy variables unless a session is made with trust_env=True. Its
#   default becomes True; a session that passes trust_env explicitly keeps its choice.
#
# Both patches apply when those modules are first imported, so a Python program that
# never uses them pays nothing. Any other sitecustomize on the path still runs.
#
# Every TCP connection and UDP destination outside the proxy is also written, one line
# each, to WHATLEAKS_SOCKETS as it happens: a poll misses sockets that live a few
# milliseconds, and UDP sent with sendto() has no peer to poll. Loopback is skipped.
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def _patch_ssl(ssl):
    ca = os.environ.get("WHATLEAKS_CA")
    if not ca or not os.path.isfile(ca):
        return
    original = ssl.create_default_context

    def create_default_context(purpose=ssl.Purpose.SERVER_AUTH, cafile=None, capath=None, cadata=None):
        ctx = original(purpose, cafile=cafile, capath=capath, cadata=cadata)
        if purpose == ssl.Purpose.SERVER_AUTH and cafile is None and capath is None and cadata is None:
            try:
                ctx.load_verify_locations(cafile=ca)
            except Exception:
                pass
        return ctx

    ssl.create_default_context = create_default_context
    # urllib and http.client make their default context through this name.
    ssl._create_default_https_context = create_default_context


def _patch_aiohttp(aiohttp):
    cls = getattr(aiohttp, "ClientSession", None)
    if cls is None:
        return
    original = cls.__init__

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("trust_env", True)
        original(self, *args, **kwargs)

    cls.__init__ = __init__


_PATCHES = {"ssl": _patch_ssl, "aiohttp": _patch_aiohttp}


def _report_sockets():
    path = os.environ.get("WHATLEAKS_SOCKETS")
    if not path:
        return
    import json
    import socket
    import threading
    import time

    cmd = os.path.basename(sys.executable or "python")
    names = {}  # address -> the hostname getaddrinfo resolved it from
    udp_seen = set()
    state = {"fd": None, "lines": 0}
    lock = threading.Lock()

    def report(proto, addr, port, host=None):
        if not addr or not port or addr == "localhost" or addr == "::1" or addr.startswith("127.") or addr.startswith("::ffff:127."):
            return
        with lock:
            if state["lines"] >= 10000:
                return
            if proto == "UDP":
                if (addr, port) in udp_seen:
                    return
                udp_seen.add((addr, port))
            line = {"proto": proto, "addr": addr, "port": int(port), "pid": os.getpid(), "cmd": cmd, "t": int(time.time() * 1000)}
            host = host or names.get(addr)
            if host and host != addr:
                line["host"] = host
            try:
                if state["fd"] is None:
                    state["fd"] = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
                os.write(state["fd"], (json.dumps(line) + "\n").encode())
                state["lines"] += 1
            except Exception:
                state["lines"] = 10000

    inet = (socket.AF_INET, getattr(socket, "AF_INET6", socket.AF_INET))

    def target(sock, address):
        if sock.family not in inet or not isinstance(address, tuple) or len(address) < 2:
            return None
        return str(address[0]), address[1]

    def proto(sock):
        return "UDP" if sock.type & socket.SOCK_DGRAM else "TCP"

    getaddrinfo = socket.getaddrinfo

    def remembering_getaddrinfo(host, *args, **kwargs):
        result = getaddrinfo(host, *args, **kwargs)
        if isinstance(host, str):
            for entry in result:
                try:
                    names.setdefault(str(entry[4][0]), host)
                except Exception:
                    pass
        return result

    connect = socket.socket.connect
    connect_ex = socket.socket.connect_ex
    sendto = socket.socket.sendto

    def wl_connect(self, address):
        t = target(self, address)
        try:
            result = connect(self, address)
        except (BlockingIOError, InterruptedError):
            # a non-blocking connect under way (asyncio)
            if t:
                report(proto(self), *t)
            raise
        if t:
            report(proto(self), *t)
        return result

    def wl_connect_ex(self, address):
        result = connect_ex(self, address)
        t = target(self, address)
        # 0, or a non-blocking connect under way (EINPROGRESS, EWOULDBLOCK)
        if t and result in (0, 36, 115, 10035, 11, 35):
            report(proto(self), *t)
        return result

    def wl_sendto(self, data, *args):
        t = target(self, args[-1]) if args else None
        if t:
            report(proto(self), *t)
        return sendto(self, data, *args)

    socket.getaddrinfo = remembering_getaddrinfo
    socket.socket.connect = wl_connect
    socket.socket.connect_ex = wl_connect_ex
    socket.socket.sendto = wl_sendto


class _Finder(object):
    """Finds the real module, then runs its patch right after the module has loaded."""

    def find_spec(self, name, path=None, target=None):
        patch = _PATCHES.get(name)
        if patch is None:
            return None
        import importlib.util

        sys.meta_path.remove(self)
        try:
            spec = importlib.util.find_spec(name)
        finally:
            sys.meta_path.insert(0, self)
        if spec is None or spec.loader is None or not hasattr(spec.loader, "exec_module"):
            return spec
        exec_module = spec.loader.exec_module

        def exec_and_patch(module):
            exec_module(module)
            try:
                patch(module)
            except Exception:
                pass

        spec.loader.exec_module = exec_and_patch
        return spec


def _install():
    if not os.environ.get("WHATLEAKS_CA"):
        return
    for name, patch in _PATCHES.items():
        if name in sys.modules:
            try:
                patch(sys.modules[name])
            except Exception:
                pass
    sys.meta_path.insert(0, _Finder())


def _chain():
    """Run the sitecustomize this file shadows, if there is one."""
    import importlib.util

    for entry in sys.path:
        if not entry or os.path.abspath(entry) == _HERE:
            continue
        candidate = os.path.join(entry, "sitecustomize.py")
        if os.path.isfile(candidate):
            spec = importlib.util.spec_from_file_location("_whatleaks_shadowed_sitecustomize", candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return


try:
    _report_sockets()
except Exception:
    pass
try:
    _install()
except Exception:
    pass
try:
    _chain()
except Exception:
    pass
