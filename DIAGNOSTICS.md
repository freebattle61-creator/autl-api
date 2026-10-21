# Diagnostics API

`diagnostics.ts` exports `mountDiagnostics(app, options)` and implements only `GET/POST /api/diagnostics`.

## Integration

Call it after creating the Express app, preferably before the main request queue. Pass exactly one store:

```ts
import { mountDiagnostics } from './diagnostics';
// Firebase: pass the license-state DatabaseReference returned by initializeFirebaseStore.
mountDiagnostics(app, { firebase: rtdb });
// SQLite: pass the already-open node:sqlite DatabaseSync instead.
mountDiagnostics(app, { sqlite });
```

With Firebase, records are stored in the sibling `<license-key>_diagnostics` node (not beneath license state). Metadata and records are JSON strings, preserving arbitrary nested keys, arrays, nulls, and numbers. With SQLite, the module creates `diagnostics_batches` separately from the license state table.

`DIAGNOSTICS_RECEIVE_LOGS=false` makes GET return `{ "receiveLogs": false }` and POST return 403. The default is enabled. POST requires `application/x-ndjson`, strict UTF-8, a newline-terminated body no larger than 2 MiB, and validates format 2, IDs, required fields, lengths, failures, and records. A successful response is `{ "id": "...", "accepted": ["..."] }`; acknowledgement follows an awaited durable save. Repeating an identical batch is 200, while reusing an ID with another payload is 409.

The route has a bounded per-IP limit (30 POSTs/minute and 1024 tracked IPs). Express 4 applications that do not wrap async handlers can still mount this route: it catches expected request/storage errors itself and forwards unexpected failures to `next`.
