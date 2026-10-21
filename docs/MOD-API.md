# Mod APIs

Base URL: `https://auth-api-zzhn-bzf6.onrender.com`

Render deployment metadata confirms the live release is commit `18a65a730d3534fc3b0d405741dd5c72a16d6ba5` (PR #3). The routes below were inspected in that exact source. No real production license was activated or heartbeated to verify success. The new activation `expires` alias in this review branch is **not live**; do not merge or deploy this change without explicit owner approval.

All three products use the existing license routes.

| Mod | product_id |
| --- | --- |
| Samurai Engine (legacy default) | `samurai-engine` |
| AIM CHETO | `aim-cheto` |
| KURO | `kuro` |

## Activate

`POST /api/activate` with `Content-Type: application/json`.

The public KURO client can send exactly:

```json
{"license_key":"YOUR-KURO-KEY","hwid":"YOUR-DEVICE-ID"}
```

`product_id` is **optional**. The server looks up the stored license by its key, then reads its product. Only legacy stored licenses with no product field default to Samurai Engine. An omitted request field does not force a KURO or AIM CHETO key into Samurai. This behavior already exists in the confirmed live source and is preserved by this change.

New clients may explicitly bind activation to a product:

```json
{"license_key":"YOUR-KURO-KEY","hwid":"YOUR-DEVICE-ID","product_id":"kuro"}
```

A supplied product must match the stored key's product. A mismatch returns HTTP 400 with `success: false`, `error_code: 1001`, `message: "Product does not match license key"`, and `session_id: null`. Unknown product IDs are rejected. Existing handling of explicit null/empty values as the legacy Samurai default is unchanged. Existing `key` and `device_fingerprint` aliases remain supported; conflicting aliases are rejected.

Both first activation and revalidation of an already activated license return the existing fields:

```json
{
  "success": true,
  "error_code": 0,
  "message": "License activated successfully",
  "session_id": "SERVER-ISSUED-SESSION",
  "expires_at": "2030-01-02T00:00:00.000Z",
  "plan": "1 Days",
  "product_id": "kuro",
  "product_name": "KURO",
  "session_expires_at": "2030-01-01T01:00:00.000Z",
  "heartbeat_interval": 60,
  "user": {"expires_at": "2030-01-02T00:00:00.000Z"},
  "seller": {"name": "Shadow Cracker"}
}
```

Values above are illustrative. Revalidation uses `message: "License validated successfully"` and issues a new session without extending the license expiry.

**Review-only addition:** both activation success paths add top-level `expires`, exactly equal to `expires_at` (the same ISO-8601 license-expiration string). This matches the owner's stated public-client requirement for `success`, `session_id`, and `expires`. All existing response fields remain present. `expires` is not a Unix timestamp, duration, or session expiry. The repository's Python reference client consumes `user.expires_at`; the stated KURO public-client source/type parser was not supplied here, so no additional parser assumptions are made.

## Heartbeat

`POST /api/heartbeat` with `Content-Type: application/json`:

```json
{"license_key":"YOUR-KEY","hwid":"SAME-DEVICE-ID","session_id":"SESSION-FROM-ACTIVATION"}
```

No `product_id` is required or validated on heartbeat. The stored session must belong to that exact key and HWID, must not be revoked or expired, and the license must still be active, enabled, unexpired, and bound to the device. No new per-mod heartbeat URL is needed.

The success schema from the confirmed live implementation is unchanged:

```json
{
  "success": true,
  "error_code": 0,
  "message": "Heartbeat OK",
  "session_id": "SAME-SERVER-ISSUED-SESSION",
  "expires_at": "2030-01-02T00:00:00.000Z",
  "plan": "1 Days",
  "session_expires_at": "2030-01-01T01:00:00.000Z",
  "heartbeat_interval": 60,
  "user": {"expires_at": "2030-01-02T00:00:00.000Z"},
  "seller": {"name": "Shadow Cracker"}
}
```

There is no heartbeat `expires`, `product_id`, `features`, or `session_valid` field. Do not require or invent these fields. The supplied requirement only establishes the `expires` alias for activation; heartbeat retains its verified schema. Successful heartbeat updates `last_heartbeat`; it does not extend license or session expiry.

Failures use `success: false`, `error_code`, and `message`. Wrong key/session or revoked session returns HTTP 401/code 2002; wrong session HWID returns 403/2005; expired session returns 401/2006; invalid/disabled license returns 403/2003; expired license returns 400/2004; reset device binding returns 403/2007. Missing inputs return 400; depending on the missing field, existing validation returns code 1001 or 2001. Activation failures include `session_id: null` on the existing explicit error paths, but this is not guaranteed for validation exceptions. Never treat HTTP 200 alone as authentication success.

## Isolated regression checks

Run `npm ci` then `npm run test:kuro-contract`. The contract suite uses only synthetic licenses and a temporary local SQLite database, with an allowlisted server environment and loopback HTTP. It covers KURO without product selection, explicit correct/wrong selection, legacy Samurai and AIM CHETO, both activation success paths, existing heartbeat responses and failures, restart persistence, and unchanged unrelated keys, prices, reseller balances and logs. No production credentials, keys, database migrations, prices or data are used or changed.

## Admin pricing

Use the admin panel's Pricing tab, select KURO or AIM CHETO, add duration rows and save. Prices can be increased or decreased independently. KURO starts without configured prices: no unapproved prices or production keys are created by deployment.

The admin API remains `POST /api/admin/prices`, requiring an admin Bearer token. Example shape only (not a production price instruction):

```json
{"product_id":"kuro","prices":{"1":5,"7":25}}
```

Key generation remains `POST /api/admin/generate` or `POST /api/reseller/generate` with `product_id`, `duration`, and `count`. Both require the corresponding authenticated session. Keys retain their mod, duration, price at issue, and issuing admin/reseller; future price changes do not alter historical issue prices.

## Original diagnostics specification

The original supplied text is preserved byte-for-byte in `diagnostics-api-spec-original.txt`. No update-check, APK download or signing features are included.
