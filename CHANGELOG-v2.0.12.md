# KEYSTONE v2.0.12

## Registry discovery pagination
- Registry lookup now returns deterministic pages instead of an unbounded response.
- Added a maximum page size of 100 and strict cursor validation at the HTTP boundary.
- Continuation cursors are scoped to the requested Nostr author; unknown cursors return an explicit error rather than silently restarting.
- Added regression tests for ordering, page continuation, and invalid cursors.

This is a local registry API improvement. It does not implement live Nostr relay discovery or production-grade shared storage.
