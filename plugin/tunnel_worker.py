"""Keep cloudflared's lifetime tied to its parent's pipe, including abrupt gateway death.

Executed as a standalone stdlib-only script: Hermes gives plugins dynamic package names.
"""
import os
import subprocess
import sys
import threading


def main():
    binary, origin, config, host_header = sys.argv[1:]
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    env = {k: v for k, v in os.environ.items() if not k.startswith("TUNNEL_")
           and k not in ("NO_TLS_VERIFY", "NO_AUTOUPDATE")}
    origin_options = ["--http-host-header", host_header] if host_header else []
    child = subprocess.Popen([binary, "--no-autoupdate", "--config", config, "tunnel",
                              "--protocol", "http2", "--metrics", "127.0.0.1:0", "--loglevel", "info",
                              *origin_options, "--url", origin],
                             stdin=subprocess.DEVNULL, stdout=sys.stdout, stderr=sys.stdout, env=env, **options)

    def stop():
        if child.poll() is None:
            try:
                child.terminate()
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            except ProcessLookupError:
                pass

    def watch_parent():
        sys.stdin.buffer.read()  # The gateway writes nothing; EOF means it has gone away.
        stop()

    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        return child.wait()
    finally:
        stop()


if __name__ == "__main__":
    sys.exit(main())
