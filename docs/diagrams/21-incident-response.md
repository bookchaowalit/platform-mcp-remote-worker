# 21 — Incident response

repo ไม่มี runbook หรือ postmortem template flow ด้านล่างประกอบจาก alert/check ที่มีจริงและขั้น rollback ที่ README / PRODUCT.md
ระบุ ตัวอย่างจริง: 2026-11-03 `wrangler deploy` ธรรมดาทำให้ `PUBLIC_ORIGIN` หาย `/mcp` ตอบ 503 และแก้ภายในไม่กี่นาที
(ops record: api-gateway-edge)

```mermaid
flowchart TD
  a1["Uptime probe on /healthz fails"] --> t
  a2["Sentry error, if SENTRY_DSN set"] --> t
  a3["Agent sees isError: not_configured, token_error, http_error 401, timeout"] --> t
  a4["CI red on main"] --> t
  t["Triage by owner"] --> q{"What broke?"}
  q -- "503 not_configured" --> f1["Check PUBLIC_ORIGIN var and MCP_TOKEN_SHA256 secret, redeploy with --var PUBLIC_ORIGIN"]
  q -- "401 for agent" --> f2["Client token mismatch: re-export from Infisical /mcp or manage.py deploy"]
  q -- "own cells 401" --> f3["owner-mcp expired: run token-rotate job, check list_cells token_configured"]
  q -- "platform cells token_error" --> f4["Check identity-api and mcp-hub client in IDENTITY_SERVICE_CLIENTS_JSON"]
  q -- "all cells upstream_error" --> f5["Gateway issue: rollback CELLS to direct origins and redeploy"]
  q -- "bad release" --> f6["wrangler rollback version-id"]
  f1 --> v["python3 verify.py and verify.py --bridge"]
  f2 --> v
  f3 --> v
  f4 --> v
  f5 --> v
  f6 --> v
  v --> pm["Record in ops memory and fix forward with test"]
```

Sources: README.md (Rollback, Security model), PRODUCT.md, src/worker.ts (status values), wrangler.toml (rollback comment),
ops record: api-gateway-edge (2026-11-03), ops record: book-platforms-status (2026-11-03), ops record: hosted-shared-services (2026-11-03)

## Open questions

- ไม่มี postmortem template หรือที่เก็บ incident record สำหรับ repo นี้
- severity / on-call ไม่ได้นิยาม (single owner)
