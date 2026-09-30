#!/usr/bin/env python3
"""Fail if the web app bundled in plugin/web references a file that isn't shipped with it.

The plugin serves plugin/web as-is, so a missing font or script means a broken (often blank) app for
everyone who installs from GitHub.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "plugin" / "web"
REF = re.compile(r"""["'(](/(?:assets|_expo/static|icons)/[^"'()\s?#]+)""")


def main() -> int:
    if not (ROOT / "index.html").is_file():
        print(f"missing {ROOT / 'index.html'}: run scripts/build-web.sh")
        return 1
    refs = set()
    for path in list(ROOT.rglob("*.js")) + list(ROOT.glob("*.html")) + list(ROOT.glob("*.webmanifest")):
        refs.update(REF.findall(path.read_text(encoding="utf-8", errors="ignore")))
    missing = sorted(r for r in refs if not (ROOT / r.lstrip("/")).is_file())
    for ref in missing:
        print(f"missing from plugin/web: {ref}")
    print(f"checked {len(refs)} asset references, {len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
