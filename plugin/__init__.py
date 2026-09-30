"""Winglet: your Hermes agents on your phone.

Registers the ``winglet`` messaging platform and the ``hermes winglet`` CLI command.
"""


def register(ctx) -> None:
    from .adapter import register as _register
    _register(ctx)


__all__ = ["register"]
