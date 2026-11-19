# Scaling and resilience

Rep is a single-writer SQLite service by design: one small container, one file, near-zero operating cost. This page records how the
usual high-scale playbook maps onto it, what is already in place, and the exact triggers for moving to the next step.

| Concern | What exists today | Move on when |
| --- | --- | --- |
| **Connection pooling** | None needed: SQLite is in-process, there is no network connection to exhaust. | Moving to Postgres: put PgBouncer in front on day one. |
| **Read replicas** | Not applicable to one file. Reads are cheap: WAL mode lets readers run beside the writer; memory-mapped I/O and a 32 MB page cache. | p95 read latency > 100 ms with indexes verified, or a second region is needed. |
| **Indexes / query shape** | Every query hits a covering index: `entities(user_id, seq)` for the sync pull, `events(user_id, at)`, token and magic-link lookups; `PRAGMA optimize` runs at open and on shutdown. Sync pulls are keyset-paged (`seq > ?`, `LIMIT`), so there is no N+1. | Slow-query log shows a scan on a large table. |
| **Write ceiling** | One writer, `synchronous=NORMAL` + WAL: thousands of small commits per second, far beyond a coaching app. Clients batch changes (400 per round) and are offline-first, so bursts are absorbed on the device. | Sustained write contention (`SQLITE_BUSY` after the 5 s busy timeout). Then: Postgres, partition `entities` by user hash. |
| **Caching** | Immutable hashed assets (`max-age=1y, immutable`), service-worker precache for the whole app shell, stale-while-revalidate for exercise images, Cloudflare edge caching for the landing site (fonts and images 30 d, css/js 1 d). Reads are served from the device first, so most opens never touch the server. | Server-computed responses get hot: add a per-user memo keyed by the user's sync `seq` with single-flight (one in-flight compute per key) in front of Redis, not after it. |
| **Request path** | Sign-in email is enqueued in a durable `mail_queue` table and sent by a worker with exponential back-off (15 s .. 10 min, 6 attempts); the request returns immediately. Push notifications run from a scheduler, never inside a request. Bodies are capped at 8 MB, idle connections at 30 s. | A second slow job type appears: generalise the queue table into a jobs table, or adopt a real broker. |
| **Stateless app tier** | Sessions are rows (hashed tokens) plus a restore cookie; no sticky routing. Rate limiters are in-process. | More than one replica is needed: move SQLite to Postgres, rate limiters and sessions to Redis, then scale on p95 latency and queue depth. Until then the deployment is pinned to one replica (`Recreate`, RWO volume). |
| **Stateful connections** | None. No WebSockets or SSE; the MCP endpoint is plain request/response over HTTP. | A live-feed feature: SSE through a dedicated fan-out gateway, never on the API pods. |
| **Graceful shutdown** | SIGTERM stops accepting, drains in-flight requests, checkpoints the WAL and closes the database before exit. | n/a |
| **Backups** | Hourly consistent snapshot (`VACUUM INTO`), integrity-checked, gzipped, copied off the node, size-verified, retention 24 local / 240 offsite (10 days). `deploy/restore-drill.sh` restores the newest copy and checks it. | Want RPO < 1 h: stream the WAL continuously (Litestream) to object storage. |

The honest ceiling: one SQLite writer on one node comfortably serves far more load than a coaching app like this generates. The
playbook above (PgBouncer, replicas, Redis, partitioning) is the migration path once those triggers are hit, and every step is
listed with the signal that justifies it, so nothing is added before it earns its keep.
