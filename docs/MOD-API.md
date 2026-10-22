# Mod API client contract

Base URL: `https://auth-api-zzhn-bzf6.onrender.com`

This document describes the stable public client contract supported by the checked-in `main/server.ts`. Examples show the required contract fields, not exhaustive responses. The server also emits the compatibility fields listed below; clients must not require them. This documentation/test alignment does not change runtime behavior, verify a live successful activation, or authorize a deployment. Any deployment needs explicit owner approval.

All three products use the same license routes: Samurai Engine (`samurai-engine`), AIM CHETO (`aim-cheto`), and KURO (`kuro`). The license key determines the product; the public client does not send `product_id`.

## Stable device identity

Use the current setup's **existing Android-ID hash**, unchanged, as `hwid`. Send exactly the same value on activation, revalidation, and every heartbeat. Do not generate a new random value, re-hash it differently, or introduce a new format. The API treats this value as an opaque device identity and binds the license/session to it; this contract does not define a new Android hashing algorithm or change the Android client.

## Activate

`POST /api/activate` with `Content-Type: application/json` and `Accept: application/json`:

```json
{"license_key":"YOUR-KEY","hwid":"EXISTING-ANDROID-ID-HASH"}
```

Send `license_key` and `hwid`; **omit `product_id`**. The server looks up the stored license by its key and reads its product. Only legacy stored licenses with no product field default to Samurai Engine. Omitting the request field does not force a KURO or AIM CHETO key into Samurai.

Both first activation and revalidation return this stable success contract:

```json
{
  "success": true,
  "session_id": "SERVER-ISSUED-SESSION",
  "heartbeat_interval": 60,
  "user": { "expires_at": "2030-01-02T00:00:00.000Z" }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `success` | boolean | Must be exactly `true` for success, with a successful HTTP status and valid required fields. |
| `session_id` | nonempty string | Save the server-issued session only after validating the successful response. Use it on heartbeat. |
| `heartbeat_interval` | integer, currently `60` | Seconds between heartbeat requests, not milliseconds. |
| `user.expires_at` | ISO-8601 UTC timestamp string | Canonical license expiration; not a duration, Unix timestamp, or session expiration. |

The timestamp and session value above are illustrative. Revalidation issues a new session without extending license expiration. Replace the saved session with the newly issued one only after successful validation. Do not require a top-level `expires`, top-level `expires_at`, or response `product_id` to accept this contract.

## Heartbeat

`POST /api/heartbeat` with the same JSON headers:

```json
{"license_key":"YOUR-KEY","hwid":"EXISTING-ANDROID-ID-HASH","session_id":"SESSION-FROM-ACTIVATION"}
```

Send the same key, unchanged HWID, and saved activation session. **Omit `product_id`**. Start heartbeats after successful activation and send them every **60 seconds**, as advertised by `heartbeat_interval`. A successful heartbeat uses the same stable fields:

```json
{
  "success": true,
  "session_id": "SESSION-FROM-ACTIVATION",
  "heartbeat_interval": 60,
  "user": { "expires_at": "2030-01-02T00:00:00.000Z" }
}
```

The returned session must match the saved session. It must belong to that exact key and HWID, must not be revoked or expired, and the license must still be active, enabled, unexpired, and bound to the device. Successful heartbeat updates `last_heartbeat`; it does not extend license or session expiration. The interval is not a session TTL: session expiration remains independently enforced by the server. Do not treat a failed heartbeat as success or replace the saved session from a failure response. No new per-product heartbeat URL is needed.

## Existing compatibility behavior (not required public fields)

The following describes current server output, not additional requirements for the stable client contract. Preserve these fields for existing consumers; public clients must tolerate their absence and ignore unrecognized extra fields.

| Endpoint | Additional fields currently emitted |
| --- | --- |
| Activation, including revalidation | `error_code: 0`, `message`, top-level `expires`, top-level `expires_at`, `plan`, `product_id`, `product_name`, `session_expires_at`, `seller.name` |
| Heartbeat | `error_code: 0`, `message`, top-level `expires_at`, `plan`, `session_expires_at`, `seller.name` |

Activation's top-level `expires` and `expires_at` are existing compatibility aliases equal to `user.expires_at`. Heartbeat currently emits top-level `expires_at` equal to `user.expires_at`, but **does not emit `expires` or `product_id`**. Neither endpoint emits `features` or `session_valid`. `session_expires_at`, when present, is the independent session expiration and is not an alias for license expiration.

Current messages are `License activated successfully` for first activation, `License validated successfully` for revalidation, and `Heartbeat OK` for heartbeat. Do not determine success from message text.

Activation still accepts an optional `product_id` for compatibility with other consumers. If supplied it must match the stored key's product; a mismatch returns HTTP 400 with `success: false`, `error_code: 1001`, `message: "Product does not match license key"`, and `session_id: null`. Unknown product IDs are rejected. Existing handling of explicit null/empty values as the legacy Samurai default is unchanged. Heartbeat does not require or validate `product_id`. Existing `key` and `device_fingerprint` request aliases remain supported; conflicting aliases are rejected. The public request examples intentionally use only `license_key` and `hwid`.

## Failures

Failures use `success: false`, `error_code`, and `message`. Never treat HTTP 200 alone as authentication success, or accept malformed/missing required success fields. Do not save a session from a failed activation.

Heartbeat errors: wrong key/session or revoked session returns HTTP 401/code 2002; wrong session HWID returns 403/2005; expired session returns 401/2006; invalid/disabled license returns 403/2003; expired license returns 400/2004; reset device binding returns 403/2007. Missing inputs return 400; depending on the missing field, existing validation returns code 1001 or 2001. Activation failures include `session_id: null` on the existing explicit error paths, but this is not guaranteed for validation exceptions.

## Isolated regression checks

Run `npm ci` then `npm run test:kuro-contract`. The contract suite uses only synthetic licenses and a temporary local SQLite database, with an allowlisted server environment and loopback HTTP. Stable-contract checks are separate from exact current-response compatibility checks: neither compatibility aliases nor product metadata are prerequisites for the public contract.

Coverage includes omitted product selection, explicit correct/wrong selection for compatibility, legacy Samurai and AIM CHETO, both activation success paths, the 60-second interval, canonical `user.expires_at`, stable opaque HWID and server-issued session reuse, heartbeat failure responses, restart persistence, and unchanged unrelated keys, prices, reseller balances and logs. No production credentials, keys, database migrations, prices or data are used or changed. Timing is asserted from the advertised interval, not by running a real Android scheduler.

## Admin pricing

Use the admin panel's Pricing tab, select KURO or AIM CHETO, add duration rows and save. Prices can be increased or decreased independently. New products start without configured prices; this contract alignment does not create prices or production keys.

The admin API remains `POST /api/admin/prices`, requiring an admin Bearer token. Example shape only (not a production price instruction):

```json
{"product_id":"kuro","prices":{"1":5,"7":25}}
```

Key generation remains `POST /api/admin/generate` or `POST /api/reseller/generate` with `product_id`, `duration`, and `count`. Both require the corresponding authenticated session. Keys retain their product, duration, price at issue, and issuing admin/reseller; future price changes do not alter historical issue prices. The public-client instruction to omit `product_id` does not apply to these admin/reseller operations.

## Original diagnostics specification

The original supplied text is preserved byte-for-byte in `diagnostics-api-spec-original.txt`. No update-check, APK download or signing features are included.
