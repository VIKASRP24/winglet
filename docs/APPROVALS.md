# Approval card identity

Every Winglet approval card stores the ID of the exact Hermes request it displays. Tapping a
card resolves only that ID. Command text, queue order, and the number of pending requests never
establish identity.

## Compatibility with current Hermes

Current Hermes calls `WingletAdapter.send_exec_approval` synchronously from
`gateway.run_turn_runner.TurnRunner._approval_notify_sync`, then schedules the returned coroutine
on its gateway loop. Its `approval_data` contains the request ID, but the adapter arguments omit it.

Winglet's synchronous wrapper reads the immediate notifier frame at that call. It accepts the ID
only when the module/function, notifier context, adapter instance, chat, and session agree. It
copies the string into a fresh metadata dictionary before returning Hermes' normal coroutine.
It does not retain frames, mutate Hermes, or install process-wide hooks. In particular, reading
the queue after scheduling cannot substitute a different request for the captured one.

At card creation, Winglet checks that the captured ID is still queued for the session and has
not already been claimed by another pending card. Missing, expired, or unsupported identity
returns a failed button send before storing or pushing a card. Hermes then sends its usual typed
`/approve` and `/deny` instructions. A Hermes refactor or a runtime without frame access can
therefore disable cards safely.

An explicitly forwarded `request_id` argument, `ExecApprovalPrompt.request_id`, or
`metadata.approval_request_id` also works. An invalid supplied identity never falls back to
capturing a different one. No Hermes changes are required for the current notifier path.

## Validation

The normal Python suite covers worker-to-loop handoff, concurrent sessions, identical commands,
withdrawn requests and replacements, invalid explicit identity, changed notifier paths, and
unavailable frames.

To check the handoff against an unmodified Hermes source checkout, set `HERMES_SOURCE` to its
root and run:

```bash
HERMES_SOURCE=/path/to/hermes-agent pytest tests/test_hermes_approval_handoff.py -q
```

That optional test executes Hermes' actual notifier, prompt dataclass, and base send method with
a worker thread and an event loop. Rendering and surrounding transport dependencies are doubled;
it does not start a model or a complete gateway. It verifies card identity and Hermes' typed
fallback, including command redaction. Without `HERMES_SOURCE`, this test is skipped.
