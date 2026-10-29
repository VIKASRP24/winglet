# Smart approvals — partial handoff

Status: **partial; not verified end to end**. This work covers Part 1 only; it does not add any approval bypass.

## Contract and changes

- The existing chat approval adapter preserves the Hermes `smart_denied` flag and now limits a flagged card's supplied choices to `once` and `deny`. The existing hub response validation checks those stored choices; it does not add missing choices. Existing owner and signature checks are unchanged.
- The chat Inbox card explains the guardian's decision and also filters its displayed choices defensively. The Tools screen explains that Smart uses an auxiliary model.
- Normal, non-denied cards retain their existing choices. No routes, policy levels or storage schemas were added or changed. The Rooms approval flow was not modified.
- No no-model warning was added: the pinned Hermes configuration and fallback behavior could not be examined reliably under the git permission restriction. Do not infer a missing model from an unknown configuration.

## Validation and limits

The plugin adapter regression uses a fake prompt and queue, and checks both stored choices and rejection of broad choices; it does not execute Hermes or a model. An app card test exercises rendering and choices. Each new denial regression was observed failing before its fix. A normal-card test exercises the Winglet handoff with a fake, not Hermes escalation itself.

The full plain plugin suite passed 668 tests with 31 skipped. The full app suite passed 457 tests, typecheck passed and the web export succeeded. The bundled web reference check passed (28 references). See the local report for commands and any later test counts.

**Pinned Hermes: CI only.** No real-Hermes tests were written here, and the pinned Hermes source was not reviewed. Smart approve, deny and escalation in chats and Rooms, command execution, and behavior with a missing model or a timeout remain unverified. Rooms use a separate worker path, and how it handles a Smart denial is not established. Treat Smart approvals as unproven until real-Hermes integration tests and a phone check cover them.
