# Mod APIs

**Review only:** KURO, diagnostics, and the premium selectors are implemented on PR #3, not deployed or merged. The base URL below is the existing service; the KURO examples require owner-approved deployment first. Existing AIM CHETO and Samurai Engine remain on the current live release.

Base URL: `https://auth-api-zzhn-bzf6.onrender.com`

All three products use the existing license routes. Select the product explicitly in activation requests to prevent using another mod's key.

| Mod | product_id |
| --- | --- |
| Samurai Engine (existing default) | `samurai-engine` |
| AIM CHETO | `aim-cheto` |
| KURO | `kuro` |

## Activate

`POST /api/activate` with `Content-Type: application/json`.

KURO example:

```json
{"license_key":"YOUR-KURO-KEY","hwid":"YOUR-DEVICE-ID","product_id":"kuro"}
```

AIM CHETO example:

```json
{"license_key":"YOUR-AIM-CHETO-KEY","hwid":"YOUR-DEVICE-ID","product_id":"aim-cheto"}
```

Successful responses include `session_id`, `expires_at`, `session_expires_at`, `product_id`, and `product_name`. A key from a different explicitly requested product is rejected. Existing clients omitting `product_id` continue to work; supply it in new clients for product isolation.

## Heartbeat

`POST /api/heartbeat`:

```json
{"license_key":"YOUR-KEY","session_id":"SESSION-FROM-ACTIVATION","hwid":"SAME-DEVICE-ID"}
```

The key and session identify the product; no new per-mod heartbeat URL is needed.

## Admin pricing

Use the admin panel's Pricing tab, select KURO or AIM CHETO, add duration rows and save. Prices can be increased or decreased independently. KURO starts without configured prices: no unapproved prices or production keys are created by deployment.

The admin API remains `POST /api/admin/prices`, requiring an admin Bearer token. Example shape only (not a production price instruction):

```json
{"product_id":"kuro","prices":{"1":5,"7":25}}
```

Key generation remains `POST /api/admin/generate` or `POST /api/reseller/generate` with `product_id`, `duration`, and `count`. Both require the corresponding authenticated session. Keys retain their mod, duration, price at issue, and issuing admin/reseller; future price changes do not alter historical issue prices.

## Original diagnostics specification

The original supplied text is preserved byte-for-byte in `diagnostics-api-spec-original.txt`. No update-check, APK download or signing features are included.
