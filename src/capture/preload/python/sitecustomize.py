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
    _install()
except Exception:
    pass
try:
    _chain()
except Exception:
    pass
