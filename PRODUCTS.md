# Samurai Engine and AIM CHETO

## Product pricing and keys

`samurai-engine` (**Samurai Engine**) remains the default existing product. Legacy keys and price rows without a product ID belong to it. `aim-cheto` (**AIM CHETO**) is separate and starts with no configured prices. An admin must explicitly add duration/price rows before generating its keys. No production prices have been chosen for the new product.

Admin and reseller generators select a product and show configured durations with prices. Admin pricing can add positive whole-day durations and increase or decrease nonnegative prices to two decimals. Keys show product, duration, price at issuance, and issuing admin/reseller username. Existing keys without a historical price show **Not recorded**, not today's price. Editing prices does not rewrite key price history. Reseller charging uses the selected product's configured price; historical balances and credentials are preserved.

Existing generation endpoints accept optional `product_id`; omission keeps Samurai Engine as the default. Admin pricing accepts:

```json
{"product_id":"aim-cheto","prices":{"7":35}}
```

This is only an example, not a seeded production price. Admin and reseller data endpoints provide a `products` catalog and product-specific price rows. This update is license management only: it does not implement gameplay features or integrate an Android/JNI `.so` library.

## Confirmed API behavior

Base URL: `https://auth-api-zzhn-bzf6.onrender.com`

Use `Content-Type: application/json` and `Accept: application/json`.

**Activation:** `POST /api/activate`

```json
{"license_key":"YOUR-KEY","hwid":"STABLE-DEVICE-ID"}
```

No citizen ID is required. Existing aliases `key` and `device_fingerprint` remain supported; conflicting aliases fail. An optional `product_id` must match the key if supplied. Validate JSON rather than accepting HTTP 200 alone. The checked-in backend and isolated local tests confirm success fields `success: true`, nonempty `session_id`, `expires_at`, `session_expires_at`, `error_code: 0`, `message`, `plan`, and `heartbeat_interval`; this update adds `product_id` and `product_name` to activation success.

**Heartbeat:** `POST /api/heartbeat`

```json
{"license_key":"YOUR-KEY","hwid":"SAME-STABLE-DEVICE-ID","session_id":"ACTIVATION-SESSION-ID"}
```

A successful heartbeat returns `success: true`, the matching session, expiration fields, and `message: "Heartbeat OK"`. Keep the same license, stable HWID and activation session. Session expiry is separate from license expiry. Do not require the proposed `features` or `session_valid` fields: they are not established fields in this implementation. Treat malformed JSON, missing required success fields and failure responses as failures.

Safe live probes confirmed health HTTP 200 with Firebase storage, unknown activation key HTTP 404 (`error_code:1002`, `message:"Invalid license key"`, `session_id:null`), missing activation fields HTTP 400 (`error_code:1001`), and invalid heartbeat session HTTP 401 (`error_code:2002`, `message:"Invalid, revoked, or expired session ID"`). Errors use `message`, not the proposed `error` property. No real production key was activated: successful responses were verified against source and isolated tests, not a live valid license.

## Validation and release safety

Passed: TypeScript lint; production build; existing HTTP regressions; product regressions covering legacy-record preservation, independent product prices, common decimal prices, zero prices, admin-only pricing, exact reseller balance deductions, immutable issuance prices, issuer attribution, activation/heartbeat and restart persistence; startup, Firebase safety and maintenance tests; ten Python client unit tests. Actual Firebase product persistence was not exercised against production.

Browser verification used a **temporary local SQLite preview**, not the live service: added AIM CHETO 7-day price 35, saved it, generated ten disposable keys, and verified product/day/price/admin issuer in the filtered key list. These test prices and keys are not in the repository or production data. Screenshot: `evidence/aim-cheto-key-list-preview.png`.

Source backup: `/workspace/autl-api-before-products.tar.gz` (verified archive). This is not a production database backup. No production data was deleted, overwritten, exported or changed for this task; live checks used only invalid-license/session probes. Changes are on a feature branch and are not merged or deployed. Before a production rollout, make a verified private Firebase/database backup and follow `DEPLOYMENT.md`. Existing versions can mis-handle product-specific price rows, so review compatibility before rollback; do not silently downgrade on product-bearing data.
