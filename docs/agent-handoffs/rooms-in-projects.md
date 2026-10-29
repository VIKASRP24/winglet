# Rooms in projects — incomplete work

Status: **not ready for review or deployment**. No capability flag is advertised and no app controls are implemented.

## Intended contract

Rooms are gateway-level and projects are bot-scoped. The intended rule is one shared owner project per room, with the project's bot in the room roster when filed. Later roster changes must not silently remove the link. Filing organizes metadata only: it must not merge project chats into the upstream Hermes transcript, change the transcript, or modify the roster.

## Work in progress

`plugin/projects.py` adds a `project_rooms` table, atomic link mutation using the existing project transaction, revision checks and idempotency receipts, and project deletion cleanup. `plugin/hub.py` contains an owner-signed move route and a read route that filters room grants and archived rooms. These routes are not yet advertised as a capability. `tests/test_project_rooms.py` exercises basic transaction behavior. This is incomplete and not security-reviewed; do not ship it as-is.

The design keeps link writes in the project database to preserve atomicity with project revisions and receipts. The move route locks room metadata while validating the roster. More work is required to establish safe cross-database ordering and to test concurrent archive, grant revocation, roster changes, deletion, and retries. In particular, room creation and filing cannot simply be treated as an atomic transaction across the Hermes runtime, room metadata, and project database; recovery and retry behavior must be designed and tested.

## Validation

`python -X utf8 -m pytest tests/test_projects.py tests/test_project_rooms.py -q`: 16 passed. No full suite, app, Hermes, red check or CI evidence is available.

## Remaining work

Implement the feature flag and app flows, creation from a project, refresh and conflict handling, and complete the authorization and lifecycle tests specified in the assignment. Run all required validation before opening a PR. Phone QA later should cover move/remove, new room, grants, roster changes, archive/deletion, offline and stale revision behavior, old-server compatibility, accessibility and reconnect.
