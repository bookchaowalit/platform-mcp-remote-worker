# 14 — Backup and DR

## ข้อมูลที่มีและที่อยู่

| ข้อมูล | ที่อยู่ | Backup จริง |
|---|---|---|
| Worker code | GitHub `bookchaowalit/platform-mcp-remote-worker` (public) | git; Cloudflare เก็บ deployment history |
| Worker config (`[vars]`, `CELLS`) | wrangler.toml ใน git | git |
| Client token `SOLO_MCP_REMOTE_TOKEN` | Infisical `/mcp` | ตาม Infisical (ไม่มีขั้นตอนใน repo) |
| Worker secrets | Cloudflare Worker secrets (ส่งจาก Infisical `/mcp`, `/ai-gateway`, `/crm`, `/income`, `/mcp-hub`, `/empire-platform`) | สร้างใหม่ได้ด้วย `manage.py deploy` |
| owner-mcp token | push โดย token-rotate job | re-mint โดย rotation job |
| Business data | ไม่มีใน Worker (อยู่ใน cell) | ดู backup ของ cell |
| Cache ใน isolate | memory | ไม่ต้อง backup (สร้างใหม่อัตโนมัติ) |

## Recovery flow

```mermaid
flowchart TD
  f["Failure"] --> k{"Kind"}
  k -- "bad code release" --> r1["wrangler rollback version-id or Cloudflare deployment history"]
  k -- "PUBLIC_ORIGIN dropped, 503" --> r2["wrangler deploy --var PUBLIC_ORIGIN:https://solo-empire-mcp-remote.bookchaowalit.workers.dev"]
  k -- "secrets lost or Worker deleted" --> r3["npm ci then python3 manage.py deploy from Infisical"]
  k -- "client token leaked" --> r4["Replace SOLO_MCP_REMOTE_TOKEN in Infisical /mcp then manage.py deploy"]
  k -- "cell route broken via gateway" --> r5["Put direct origin from CELL_HOSTS back in CELLS and redeploy"]
  r1 --> v["python3 verify.py"]
  r2 --> v
  r3 --> v
  r4 --> v
  r5 --> v
```

Sources: README.md (Rollback, ตรวจและ deploy), PRODUCT.md (How it runs and deploys), manage.py (`deploy`, `worker_secrets`, `bootstrap`),
wrangler.toml (rollback comment), ops record: api-gateway-edge (2026-11-03)

RTO / RPO: not defined (ไม่มีใน repo) RPO ในทางปฏิบัติไม่เกี่ยวเพราะไม่มีข้อมูล persist

## Open questions

- `manage.py bootstrap` ไม่ทับ token ที่มีอยู่ — ขั้นตอน rotate client token ที่ตั้งใจคืออะไร (ลบใน Infisical แล้ว bootstrap?)
- RTO เป้าหมายของ hub
