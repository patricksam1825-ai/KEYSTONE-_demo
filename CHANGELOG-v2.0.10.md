# KEYSTONE v2.0.10

## Registry discovery ambiguity hardening

- Registry validation now requires exactly one `t=keystone-binding` topic tag.
- Duplicate matching topic tags are rejected instead of being silently accepted.
- Added a regression test for ambiguous discovery metadata.

This is a narrow validation hardening change. It does not add live relay verification, Mainnet transaction broadcasting, public hosting, or production readiness.
