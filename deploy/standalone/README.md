# SLH TMS V2 standalone runtime

This is the clean deployment path for V2. It deliberately does not connect to the historic Azure SQL database.

## Layout

- Web: blue-theme V2 React portal
- API: clean V2 .NET API
- SQL: fresh SQL Server database named `SLH_TMS_V2`
- Authentication: individual TMS accounts using local JWT authentication
- Secrets: runtime environment variables only
- Archive: optional mounted SLH server path

Clone the canonical Web and API repositories as sibling directories:

```
parent/
  slh-tms-v2-web/
  slh-tms-v2-api/
```

From `slh-tms-v2-web`, copy `.env.standalone.example` to `.env.standalone`, populate secrets, then run:

```bash
docker compose --env-file .env.standalone -f deploy/standalone/docker-compose.yml up -d --build
```

The portal is exposed on `TMS_HTTP_PORT` (default 8080).

## Archive safety

The API will not purge a single database row merely because `ARCHIVE_ENABLED=true`.

The actual mounted archive root must contain:

```
SLH_TMS_ARCHIVE_READY.txt
```

Create that marker only on the real SLH server archive share after the host mount has been verified. Every archive batch is written as gzip JSONL, SHA-256 verified after rename, and only then is the corresponding SQL batch deleted.

## Clean database rule

Never restore the old SLH TMS production database into this runtime. The database is built from the V2 schema migrations only. Reconciled master data should be imported explicitly after the fresh database is healthy.
