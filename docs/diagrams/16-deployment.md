# 16 — Deployment

```mermaid
flowchart TB
  subgraph laptop["Operator machine"]
    repo["Clone with node_modules (npm ci)"]
    mg["manage.py deploy"]
    inf["Infisical CLI"]
  end
  subgraph cf["Cloudflare account"]
    api["api.cloudflare.com: workers/subdomain"]
    subgraph wk["Worker solo-empire-mcp-remote"]
      code["main = src/worker.ts, compatibility_date 2026-10-04, nodejs_compat"]
      vars["vars: AI_API_ORIGIN, AGENCY_CRM_ORIGIN, INCOME_CRM_ORIGIN, ALLOWED_ORIGINS empty, MCP_READONLY empty, IDENTITY_CLIENT_ID mcp-hub, CELLS, PUBLIC_ORIGIN via --var"]
      sec["secrets: MCP_TOKEN_SHA256, AI_API_READ_TOKEN, AGENCY_CRM_TOKEN, INCOME_CRM_TOKEN, IDENTITY_CLIENT_PRIVATE_KEY_PEM, EMPIRE_OWNER_MCP_TOKEN, SENTRY_DSN"]
    end
    route["workers.dev route: https://solo-empire-mcp-remote.bookchaowalit.workers.dev"]
  end
  subgraph rail["Railway"]
    rot["platform-empire token-rotate cron"]
  end
  repo --> mg
  inf --> mg
  mg -- "resolve workers.dev subdomain" --> api
  mg -- "wrangler deploy --var PUBLIC_ORIGIN" --> code
  mg -- "wrangler secret bulk via stdin" --> sec
  rot -- "push EMPIRE_OWNER_MCP_TOKEN weekly" --> sec
  route --> wk
```

- Hosting: Cloudflare Workers, `workers_dev = true` ไม่มี custom domain หรือ `routes` ใน wrangler.toml
- Bindings: มีเฉพาะ vars และ secrets (ไม่มี KV/D1/R2/DO/Queue/cron triggers)
- Environments: production เดียว (ไม่มี `[env.*]`); Infisical environment default `dev` ใน `manage.py bootstrap`
- Code-only redeploy: `wrangler deploy --var PUBLIC_ORIGIN:<origin>` พร้อม Cloudflare credentials จาก Infisical `/cloudflare` (PRODUCT.md)

Sources: wrangler.toml, manage.py (`public_origin`, `deploy`, `worker_secrets`), src/worker.ts (`Env`), PRODUCT.md,
README.md, ops record: hosted-shared-services (2026-11-03), ops record: api-gateway-edge (2026-11-03)

## Open questions

- `SENTRY_DSN` ถูกตั้งบน Worker แล้วหรือยัง (PRODUCT.md 2026-10-23 บอกยังปิด; `manage.py` ไม่ส่งค่านี้)
- ต้องการ custom domain แทน workers.dev หรือไม่
