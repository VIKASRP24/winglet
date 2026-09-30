# History synchronization

Messages include `position`, their SQLite insertion position. Both HTTP history and socket events
carry it. Clients order confirmed rows by position, keep optimistic rows after them, and page using
`before_position`. Unlike a message-ID cursor, a numeric boundary still works if its message is deleted
before the next request. `before_id` and timestamp `before` remain supported for older clients.

`GET /api/chats/<chat-id>/messages` returns `messages` and `deleted_ids`. The latter contains durable
deletion markers for that chat, including messages outside the current page. Deleting a message or
chat records markers in the same database transaction as the deletion. Gateway restarts preserve them.

The app combines these markers with socket delete events before merging any history response.
That repairs deletions missed while offline and prevents an in-flight snapshot or stale update from
resurrecting a deleted message. Rows absent from one page are otherwise retained, so older loaded
pages and replies newer than a snapshot stay visible. Older servers without these fields retain the
previous merge behavior; deletion reconciliation requires an upgraded hub and app.

Markers are retained for the database lifetime because a phone may reconnect after a long absence.
They contain only message and chat IDs, not deleted message content. Future retention policies must
invalidate client history caches before pruning markers.
