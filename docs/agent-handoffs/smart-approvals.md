# Smart approvals — partial handoff

Status: **not verified end to end; changes uncommitted**. This work covers Part 1 only; it does not add any approval bypass.

## Contract and changes

- The existing chat approval adapter preserves the Hermes `smart_denied` flag and now limits a flagged card's supplied choices to `once` and `deny`. The existing hub response validation checks those stored choices; it does not add missing choices. Existing owner and signature checks are unchanged.
- The chat Inbox card explains the guardian's decision and also filters its displayed choices defensively. The Tools screen explains that Smart uses an auxiliary model.
- Normal, non-denied cards retain their existing choices. No routes, policy levels or storage schemas were added or changed. The Rooms approval flow was not modified.
- No no-model warning was added: the pinned Hermes configuration and fallback behavior could not be examined reliably under the git permission restriction. Do not infer a missing model from an unknown configuration.

## Validation and limits

The plugin adapter regression uses a fake prompt and queue, and checks both stored choices and rejection of broad choices; it does not execute Hermes or a model. An app card test exercises rendering and choices. Each new denial regression was observed failing before its fix. A normal-card test exercises the Winglet handoff with a fake, not Hermes escalation itself.

The full plain plugin suite passed 668 tests with 31 skipped. The full app suite passed 457 tests, typecheck passed and the web export succeeded. The bundled web reference check passed (28 references). See the local report for commands and any later test counts.

**pinned-Hermes: CI only** — no real-Hermes tests were authored or run here. The required pinned source is available only via `git show`, which the worktree permission hook blocked; the non-pinned working copy was not used as a substitute. Smart approve/deny/escalation in chat and Rooms, command execution, missing-model and timeout behavior remain unverified. Rooms currently exposes once/deny controls through a separate worker path; its handling of Smart denial is not established. Pinned source review and real-Hermes integration tests are required before treating this task as complete. CI and physical-device testing were not run. The reviewer must commit and open the PR; no push or PR was made.
