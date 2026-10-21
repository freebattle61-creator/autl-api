# License API deployment notes

The corrected copy restores the original full application and adds revision-based persistence. It is **not a production deployment**. Before deployment, provide private environment settings on the target host and validate backups, storage durability, credentials, process topology, and monitoring.

## Existing Render release gate

The existing `auth-api-zzhn-bzf6.onrender.com` service is healthy with Firebase storage. Its automatic deployments are disabled. Its current build command downloads and extracts an older ZIP over the repository, so a GitHub push alone will not update the running application. After release approval, replace that override with `npm ci && npm run build`, keep `npm start`, use Node.js 24, and set `HOST=0.0.0.0` in the private service environment. Do not change the hosting plan.

A read-only inspection of the saved Firebase instance found existing license state at `/license_api` without the numeric revision required by this release. Do not deploy this release against that state as-is, initialize a fresh empty store in its place, or run the migration script against that nonempty path. Confirm the actual Render database URL/path privately before any release action.

The owner must approve a migration/cutover plan before deployment: pause writes on the old service, take a private consistent backup, normalize only omitted empty collections, validate all six state fields, copy into a new empty non-root namespace using the guarded migration tool, verify record preservation, and switch the service to that namespace. Preserve the original namespace and backup. Never resume the old writer concurrently, and never blindly roll back after new writes without reconciling them. No migration, production-data write, service-configuration change, or Render deployment was performed while preparing this repository update.

## SQLite (default)

Set `LICENSE_DB_FILE` to a persistent private path. If omitted, the service uses `~/.license-api/license.sqlite`. Set `ADMIN_PASSWORD` when initializing an empty database; optionally set `ADMIN_USERNAME`. The service refuses to initialize an empty store without an explicit password and never creates a demo reseller. SQLite uses WAL, a busy timeout, and revision-checked atomic updates. Run multiple processes only after validating the deployment's SQLite filesystem and contention characteristics.

```text
NODE_ENV=production
PORT=8317
LICENSE_DB_FILE=/var/lib/license-api/license.sqlite
ADMIN_USERNAME=your-admin
ADMIN_PASSWORD=<private-long-random-password>
```

## Firebase (optional)

Set `FIREBASE_DATABASE_URL` to the HTTPS Firebase instance URL, `FIREBASE_DATABASE_PATH` to a dedicated non-root path such as `/license_api`, and supply service-account credentials through a private environment secret or credential file. Firebase state must include the complete six-field schema and numeric `revision`; incompatible nonempty data is rejected. Writes use a revision-checked transaction and do not blind-write the root. Firebase was not exercised in this correction and requires deployment-specific validation.

## Migration

`migrate.ts` requires `MIGRATION_SOURCE_FILE`, validates `admin`, `resellers`, `prices`, `keys`, `sessions`, and `balance_logs`, and defaults to dry-run. Only `MIGRATION_ALLOW_WRITE=1` enables the destination transaction, which commits only when the selected non-root destination is still empty. Keep a backup and inspect the source before enabling writes.

## Checks and caveats

Run `npm ci`, `npm run lint`, `npm run build`, and the repeatable isolated HTTP test suite before release. Do not copy a source `.env`, live database, or credentials into the delivery directory. No external service was deployed, the original ARM64 `.so` was not patched, and no Android activation test is claimed. The API's request/response compatibility was tested locally with generated isolated licenses; Firebase and production multi-process behavior remain deployment validation items.
