# 05 — C4 Context

```mermaid
C4Context
  title System context for solo-empire-mcp-remote
  Person(owner, "Owner", "Runs AI agents; the only intended user")
  System_Ext(agents, "AI agent clients", "Claude Code local or cloud, Codex via launch.py")
  System(hub, "solo-empire-mcp-remote", "Cloudflare Worker: remote MCP tool hub at /mcp")
  System_Ext(gateway, "Edge API gateway", "gateway.bookchaowalit.com/v1/system")
  System_Ext(cells, "Solo Empire cells", "28 own cell APIs on Railway incl. tasks-api")
  System_Ext(platform, "Book Platform services", "9 platform-* services on Railway")
  System_Ext(identity, "platform-identity", "OAuth token endpoint /v1/token")
  System_Ext(legacy, "Legacy upstreams", "AI gateway api.bookchaowalit.com, Agency CRM, Income CRM")
  System_Ext(infisical, "Infisical", "Secret store for client token and Worker secrets")
  System_Ext(rotation, "token-rotate job", "platform-empire Railway cron, pushes owner-mcp secret")
  System_Ext(sentry, "Sentry", "Error reports when SENTRY_DSN is set")
  System_Ext(uptime, "platform-uptime-worker", "Probes /healthz")

  Rel(owner, agents, "Uses")
  Rel(agents, hub, "MCP over HTTPS, bearer token")
  Rel(agents, infisical, "Reads client token at connect")
  Rel(hub, gateway, "call_cell, describe_cell")
  Rel(gateway, cells, "Routes /v1/system")
  Rel(gateway, platform, "Routes /v1/platform-svc")
  Rel(hub, identity, "client_credentials for platform-* cells")
  Rel(hub, legacy, "Fixed health and read paths")
  Rel(rotation, hub, "Pushes EMPIRE_OWNER_MCP_TOKEN")
  Rel(hub, sentry, "Errors only")
  Rel(uptime, hub, "GET /healthz")
```

Sources: wrangler.toml (`CELLS`, `[vars]` origins), src/worker.ts (`IDENTITY_ORIGIN`, `GATEWAY_ORIGIN`, `services`),
README.md (rotation, Infisical paths), src/sentry.ts, platform-uptime-worker `src/targets.ts` (target `mcp-remote`, read-only),
ops record: hosted-shared-services (2026-11-03)

หมายเหตุ: CELLS ใน wrangler.toml มี 38 entry = 29 own (28 cell + `tasks`) และ 9 `platform-*` ทั้งหมดชี้ gateway
`CELL_HOSTS` (direct Railway host) เก็บไว้เป็น rollback list

## Open questions

- cell จำนวนใน PRODUCT.md (28) และ README (27 + tasks) เก่ากว่า wrangler.toml ปัจจุบัน (38 entry) ควรอัปเดต docs หรือไม่
