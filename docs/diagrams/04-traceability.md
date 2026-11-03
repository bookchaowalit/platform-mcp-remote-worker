# 04 — Traceability matrix (RTM)

repo ไม่มี `specs/` requirement มาจากตาราง "What exists" และ "Limits" ใน PRODUCT.md (ใช้ ID ชั่วคราว R-xx ในไฟล์นี้เท่านั้น)
release = CI `ci.yml` (ไม่ deploy) + deploy มือ `manage.py deploy`

| ID | Requirement (PRODUCT.md) | Code module | Test | Release / workflow |
|---|---|---|---|---|
| R-01 | `POST /mcp` Streamable HTTP stateless JSON, fresh server per request | `src/worker.ts` `handleRequest`, `serverFor` | `tests/worker.test.ts` "real SDK initializes, lists ... across fresh transports" | ci.yml `worker`; smoke.mjs |
| R-02 | Bearer token, SHA-256 only, constant-time compare, 401 | `authorized`, `authConfigured` | worker.test.ts "auth fails closed and uses fixed errors" | ci.yml `worker`; smoke.mjs no-auth 401 |
| R-03 | Host and browser Origin checked (403) | `handleRequest` origin block | worker.test.ts "host and browser origin are validated" | ci.yml `worker` |
| R-04 | `/healthz` ok only when auth + `PUBLIC_ORIGIN` configured | `handleRequest` healthz | worker.test.ts "health discloses only readiness"; sentry-worker.test.ts | uptime target `mcp-remote` |
| R-05 | `list_cells` metadata without token values | `registerCellTools` | worker.test.ts "list_cells reports names, hosts and token presence" | ci.yml `worker` |
| R-06 | `describe_cell` compact ops, cache 5 min, scrubbed | `describeCell`, `compactOperations` | worker.test.ts describe_cell (3 tests) | ci.yml `worker` |
| R-07 | `call_cell` GET/POST/PATCH/PUT, `/v1/`, no DELETE, `MCP_READONLY` | `callCell`, `cellPath`, `readOnly` | worker.test.ts "path validation", "method allowlist" | ci.yml `worker` |
| R-08 | Hosts must be in `CELL_HOSTS` or gateway route | `cellBase`, `cellsFrom` | worker.test.ts "host allowlist", "gateway bases", "wrangler CELLS routes every own cell" | ci.yml `worker` |
| R-09 | Delegated owner-mcp token, `not_configured` when absent | `callCell` | worker.test.ts "missing EMPIRE_OWNER_MCP_TOKEN", "own cells keep the owner-mcp token" | manage.py deploy; token-rotate job |
| R-10 | Platform cells via identity client_credentials + private_key_jwt, cached | `platformToken`, `PLATFORM_CELLS`, `signingKey` | worker.test.ts platform tests (5) | manage.py deploy (`/mcp-hub`) |
| R-11 | Limits: 64 KiB input, 15 s deadline, no redirects, 2 MiB read / 100 KiB returned | `boundedText`, `withDeadline`, `fitResponse` | worker.test.ts "rejects malformed JSON ...", "deadline aborts", "truncates large bodies" | ci.yml `worker` |
| R-12 | Secrets redacted from all output | `scrub`, `redact`, `dropSecretPrefix` | worker.test.ts "token never reaches output", "scrubs secrets before clipping" | ci.yml `worker` |
| R-13 | Legacy fixed-path tools | `services`, `upstream` | worker.test.ts tests at lines 108–175 | ci.yml `worker`; smoke.mjs |
| R-14 | Sentry errors only, no request/headers/args | `src/sentry.ts`, `Sentry.withSentry` | tests/sentry.test.ts, tests/sentry-worker.test.ts | ci.yml `worker` |
| R-15 | Deploy forwards hash not raw token; optional secrets only when present; no value printed | `manage.py` `worker_secrets`, `deploy`, `fixed_command` | tests/manage_test.py (6 tests) | ci.yml `scripts` |
| R-16 | Codex config holds no token value | `manage.py configure`, `launch.py` | manage_test.py "preserves unrelated client config ..." | ci.yml `scripts` |
| R-17 | Security scans | — | — | ci.yml `security` (gitleaks, semgrep, osv-scanner, trivy-fs) |

Sources: PRODUCT.md, src/worker.ts, src/sentry.ts, manage.py, tests/worker.test.ts, tests/sentry.test.ts,
tests/sentry-worker.test.ts, tests/manage_test.py, smoke.mjs, .github/workflows/ci.yml

## Open questions

- PRODUCT.md บอก "35 Node tests and 6 Python tests" — ไม่มี requirement ID ทางการ ควรย้ายเป็น `specs/` หรือไม่?
- ไม่มี test อัตโนมัติสำหรับ `launch.py` / `bridge.mjs` (ตรวจด้วย `verify.py --bridge` แบบมือเท่านั้น)
