# KEYSTONE v2.1.10

- First public-relay run on owner machine: both relays failed with the generic message "Publish failed." Cause of the vague message: nostr-tools rejects a refused publish with a plain string, and relays.js only read `.message`. Now the relay's real reason is kept (describeRelayError) and shown.
- Added `npm run relay:diagnose -- wss://relay1 wss://relay2` (scripts/relay-diagnose.mjs): prints connection, read test and the relay's raw reply to a small signed test event. Not executed by the author (needs internet).
- Tests: 143 (sandbox: 137 pass, 6 skipped = libauth/nostr-tools/ws not installed there).
