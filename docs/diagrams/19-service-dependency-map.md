# 19 — Service dependency map

```mermaid
flowchart LR
  hub["solo-empire-mcp-remote (Cloudflare Worker)"]
  subgraph runtime["Runtime dependencies"]
    gw["Edge gateway gateway.bookchaowalit.com"]
    own["29 own cells incl. tasks-api route empire-platform"]
    plat["9 platform services: commerce, communication, data, developer, logistics, media, payment, security, workflow"]
    idp["platform-identity identity-api-production-fad1"]
    ai["AI gateway api.bookchaowalit.com"]
    agency["Agency CRM crm-api-production-a7e0"]
    income["Income CRM crm-api-production-19fd"]
    sentry["Sentry (optional)"]
  end
  subgraph supply["Secret and token suppliers"]
    rot["platform-empire token-rotate (Railway cron)"]
    inf["Infisical"]
  end
  subgraph build["Build and deploy"]
    cfapi["Cloudflare API and Wrangler 4.131.1"]
    sdk["@modelcontextprotocol/sdk 1.32.1, zod 4.6.6, @sentry/cloudflare 11.6.0"]
    ciw["platform-ci-workflows v1.0.1"]
  end
  subgraph consumers["Consumers"]
    cc["Claude Code via solo plugin .mcp.json"]
    cx["Codex via launch.py"]
    up["platform-uptime-worker probe"]
  end
  cc --> hub
  cx --> hub
  up --> hub
  hub --> gw
  gw --> own
  gw --> plat
  hub --> idp
  hub --> ai
  hub --> agency
  hub --> income
  hub -.-> sentry
  rot --> hub
  inf --> hub
  cfapi --> hub
  sdk --> hub
  ciw --> hub
```

Sources: wrangler.toml, src/worker.ts (`CELL_HOSTS`, `IDENTITY_ORIGIN`, `services`), package.json, .github/workflows/ci.yml,
manage.py, launch.py, platform-uptime-worker `src/targets.ts` (read-only), ops record: hosted-shared-services (2026-11-03)

Failure impact: gateway down → `call_cell` / `describe_cell` ทุก cell ล้ม (rollback = direct origin ใน `CELLS`);
identity down → เฉพาะ `platform-*` ได้ `token_error`; rotation ไม่ push → owner-mcp หมดอายุ → own cells `http_error` 401

## Open questions

- ไม่มี
