# License client reference (standalone)

A compact, dependency-free Python reference client for the **verified Express API**. It does not modify Android binaries or any production source.

## Scope and configuration

```python
from license_client import ClientConfig, LicenseClient

client = LicenseClient(ClientConfig(
    base_url="https://your-verified-express-host",
    profile="verified_express",
    timeout_seconds=10,
))
session = client.activate(license_key, device_hwid)
# Schedule the next call using session.heartbeat_interval.
client.heartbeat()
```

- `base_url` and `profile` are explicit; the only accepted profile is `verified_express`.
- HTTPS is required. HTTP is accepted only when `allow_http_loopback=True` and the host is `localhost`, `127.0.0.1`, or `::1` for development.
- The client sends `license_key` (not the ambiguous alias `key`) and `hwid` on activation; heartbeat sends `license_key`, `session_id`, and `hwid`.
- The newer declared API that advertises `device_fingerprint` is deliberately **not supported**. This client does not claim that API's success or heartbeat behavior works.

## Verified success contract

Both POST responses must have a 2xx HTTP status **and** JSON `success: true`, plus:

```json
{
  "success": true,
  "session_id": "non-empty",
  "heartbeat_interval": 60,
  "user": { "expires_at": "ISO-8601 timestamp" }
}
```

The client rejects malformed JSON, non-object JSON, missing/wrongly typed fields, expired license timestamps, conflicting heartbeat session IDs, non-2xx responses (including `500` with `success: true`), and `success: false` even with HTTP 200. The corrected backend provides top-level `session_expires_at`, which is parsed and enforced locally. Legacy nested session expiry is also understood, but conflicting top-level/nested expiry values are rejected. Top-level license expiry, when present, must agree with `user.expires_at`. The unmodified original Express backend omits session expiry, so that profile also permits absence and then relies on server heartbeat validation.

Any network error, timeout, invalid response, 5xx, protocol failure, failed activation, or expired state clears the usable state (fail closed). A failed activation always clears a prior session.

## State and Android integration

Session and key material are held **in memory only**; this reference client writes no disk token/cache and never logs keys, HWIDs, or session IDs. `revoke_local()` clears memory. For Android, use a native integration with Android Keystore for any persistence and keep this client as a protocol/reference boundary; do not patch or replace an Android `.so` with it.

`license_client.py` uses only Python standard library `urllib`. Production apps should still apply their platform's certificate validation and lifecycle/background scheduling policy.

## Tests

Run:

```bash
python3 -m unittest -v
```

Ten unit tests use an injected fake HTTP transport and cover malformed JSON, missing fields, `success:false`/HTTP 200, HTTP 500 with `success:true`, timeout, correct payloads, top-level/local expiry, conflicting expiry/session fields, HTTPS/loopback policy, and unsupported profiles. These are unit tests, not external live-API verification.

An additional actual-HTTP test launches the corrected Node backend with a generated temporary SQLite database and private random test admin, creates a license through authenticated admin routes, verifies activation/heartbeat, restarts the backend and validates the same session, then revokes the license and checks fail-closed client state:

```sh
python3 test_backend_integration.py /workspace/license-api-fixed
```

Build that backend first. This test passed; it does not exercise the external preview-memory API or the Android ARM64 binary. It removes its temporary database and stops its own processes. Redirects are rejected, API base URLs cannot contain credentials/path/query/fragment, and default response reads have a size limit.
