"""Dependency checks and explicit preparation through Hermes's package manager."""

from __future__ import annotations

import importlib

# Probe the APIs we actually use, including cryptography's native extension.
IMPORTS = {
    "aiohttp": "aiohttp.web",
    "cryptography": "cryptography.hazmat.primitives.ciphers.aead",
    "httpx": "httpx",
    "qrcode": "qrcode",
}


def missing_dependencies() -> list[str]:
    missing = []
    for package, module in IMPORTS.items():
        try:
            importlib.import_module(module)
        except Exception:
            missing.append(package)
    return missing


def ensure_ready(*, install: bool = False) -> bool:
    missing = missing_dependencies()
    if not missing:
        return True
    if not install:
        print("Pairing is not ready: missing or unusable dependencies: " + ", ".join(missing))
        print("Run `hermes winglet setup` to prepare them before pairing.")
        return False

    print("Preparing Winglet dependencies with Hermes: " + ", ".join(missing))
    try:
        from pm import sync_venv

        # Resolve the enabled plugin's declaration in the shared managed environment.
        # Never install into whichever system Python happens to own `pip`.
        sync_venv(explicit=True)
    except Exception as exc:
        print(f"Winglet setup could not prepare dependencies: {exc}")
        print("Run `hermes plugins update winglet`, then `hermes plugins enable winglet` and retry setup.")
        return False

    try:
        from pm.environments_adopt import adopt_selected
        from pm.paths import repo_root

        if not adopt_selected(repo_root()):
            print("Dependencies prepared. Run `hermes winglet setup` again to load them.")
            return False
        importlib.invalidate_caches()
    except ImportError:
        # Older package managers can prepare the environment but cannot adopt it
        # safely in a running process. The next CLI invocation loads it at boot.
        print("Dependencies prepared. Run `hermes winglet setup` again to load them.")
        return False
    except Exception as exc:
        print(f"Dependencies prepared, but Winglet could not load them: {exc}")
        print("Run `hermes winglet setup` again in a fresh Hermes process.")
        return False

    remaining = missing_dependencies()
    if remaining:
        print("Winglet setup is not ready: dependencies still unavailable: " + ", ".join(remaining))
        print("Restart Hermes and retry `hermes winglet setup`.")
        print("If this persists, run `hermes plugins update winglet` and `hermes plugins enable winglet`.")
        return False
    return True
