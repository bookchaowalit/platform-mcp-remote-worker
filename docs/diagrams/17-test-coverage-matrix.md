# 17 — Test coverage matrix

Test levels ที่มีจริง: **unit/integration ในโปรเซส** (`tests/worker.test.ts`, `tests/sentry*.test.ts` ใช้ real MCP SDK กับ
fetch mock; `tests/manage_test.py` ใช้ mock subprocess) และ **live smoke** (`smoke.mjs` ผ่าน `verify.py`, รันมือ ไม่อยู่ใน CI)
ไม่มี e2e อัตโนมัติกับ upstream จริง

| Feature | Unit / in-process integration | Live smoke (manual) | Gap |
|---|---|---|---|
| `/healthz` readiness | worker.test.ts "health discloses only readiness"; sentry-worker.test.ts | — (uptime-worker probes) | — |
| Auth 401 / origin 403 / body limits | worker.test.ts auth, host/origin, malformed JSON tests | smoke.mjs no-auth 401 | No rate-limit test (no feature) |
| MCP initialize / list / fresh transports | worker.test.ts "real SDK initializes ..." | smoke.mjs two fresh HTTPS clients + bridge | — |
| Legacy tools | worker.test.ts tests (missing tokens, fixed paths, health, redirects, deadline) | smoke.mjs calls all 5 | — |
| `list_cells` | worker.test.ts | smoke.mjs | — |
| `describe_cell` | worker.test.ts (3 tests) | — | No live check |
| `call_cell` own cells | worker.test.ts (path, methods, readonly, not_configured, forwarding, truncation, deadline) | — | No live call in smoke |
| Gateway base rules | worker.test.ts "gateway bases", "wrangler CELLS routes every own cell" | — | — |
| Platform identity tokens | worker.test.ts 5 platform tests | — | No live call in smoke |
| Redaction | worker.test.ts scrub/redact tests | smoke prints metadata only | — |
| Sentry scrub | sentry.test.ts (6), sentry-worker.test.ts | — | — |
| `manage.py` deploy / configure | manage_test.py (6) | — | `status`, `bootstrap` not unit tested |
| `launch.py`, `bridge.mjs` | — | `verify.py --bridge` | No automated test |

Commands: `npm test` (`tsx --test tests/*.test.ts`), `python -m unittest discover -s tests -p "*_test.py"`, `python3 verify.py [--bridge]`

Sources: tests/worker.test.ts, tests/sentry.test.ts, tests/sentry-worker.test.ts, tests/manage_test.py, smoke.mjs, verify.py,
package.json, .github/workflows/ci.yml

## Open questions

- ไม่มี coverage % (ไม่มี coverage tool ใน package.json) — จะใช้ CI v1.1.0 coverage gate หรือไม่
