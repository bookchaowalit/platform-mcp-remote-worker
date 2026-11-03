# Core 22 SDLC diagram pack — platform-mcp-remote-worker

ชุดแผนภาพ 22 รายการตาม SDLC Diagram Catalog v2 สำหรับ Cloudflare Worker `solo-empire-mcp-remote`
(remote MCP tool hub) วาดจากโค้ดและ config ใน repo นี้ ณ `origin/main` `0a0e32d` (2026-11-03)
ทุกไฟล์มีหัวข้อ `Sources:` และ `Open questions` ของตัวเอง

ภาพรวม: Worker ตัวเดียว (`src/worker.ts`) เสิร์ฟ `POST /mcp` (MCP Streamable HTTP, stateless JSON mode) และ
`GET /healthz` ไม่มี storage binding, cron หรือ queue ผู้เรียกคือ AI agent ของเจ้าของ (Claude Code, Codex ผ่าน
`launch.py` + `bridge.mjs`) Worker เรียกต่อไปยัง cell API ผ่าน edge gateway และ upstream เดิม 3 ตัว (AI, Agency CRM, Income CRM)

| # | Item | Status | File | Sources read |
|---|---|---|---|---|
| 01 | Business process (As-Is / To-Be) | done | [01-business-process.md](01-business-process.md) | README.md, PRODUCT.md, src/worker.ts |
| 02 | Use cases | done | [02-use-cases.md](02-use-cases.md) | src/worker.ts, manage.py, README.md |
| 03 | User flows | done | [03-user-flows.md](03-user-flows.md) | README.md, src/worker.ts, launch.py, bridge.mjs |
| 04 | Traceability (RTM) | done | [04-traceability.md](04-traceability.md) | PRODUCT.md, tests/*, .github/workflows/ci.yml |
| 05 | C4 context | done | [05-c4-context.md](05-c4-context.md) | src/worker.ts, wrangler.toml |
| 06 | C4 container | done | [06-c4-container.md](06-c4-container.md) | src/worker.ts, bridge.mjs, launch.py, manage.py |
| 07 | C4 component | done | [07-c4-component.md](07-c4-component.md) | src/worker.ts, src/sentry.ts |
| 08 | ADRs (retro-documented) | done | [08-adr/](08-adr/) | src/worker.ts, wrangler.toml, manage.py, central ADR-0003 |
| 09 | ERD | not_applicable | [09-erd.md](09-erd.md) | wrangler.toml (no KV/D1/R2/DO/Queue binding), src/worker.ts |
| 10 | Sequences | done | [10-sequences.md](10-sequences.md) | src/worker.ts |
| 11 | State machines | done | [11-state-machines.md](11-state-machines.md) | src/worker.ts |
| 12 | API & integration | done | [12-api-integration.md](12-api-integration.md) | src/worker.ts, wrangler.toml, manage.py |
| 13 | Threat model | done | [13-threat-model.md](13-threat-model.md) | src/worker.ts, src/sentry.ts, manage.py, README.md |
| 14 | Backup / DR | done | [14-backup-dr.md](14-backup-dr.md) | README.md, PRODUCT.md, manage.py |
| 15 | CI/CD pipeline | done | [15-cicd-pipeline.md](15-cicd-pipeline.md) | .github/workflows/ci.yml, package.json |
| 16 | Deployment | done | [16-deployment.md](16-deployment.md) | wrangler.toml, manage.py |
| 17 | Test coverage matrix | done | [17-test-coverage-matrix.md](17-test-coverage-matrix.md) | tests/*.test.ts, tests/manage_test.py, smoke.mjs |
| 18 | Git / release workflow | done | [18-git-release-workflow.md](18-git-release-workflow.md) | git log, .github/workflows/ci.yml, PRODUCT.md |
| 19 | Service dependency map | done | [19-service-dependency-map.md](19-service-dependency-map.md) | wrangler.toml, src/worker.ts, manage.py |
| 20 | Observability | done | [20-observability.md](20-observability.md) | src/sentry.ts, src/worker.ts, platform-uptime-worker targets |
| 21 | Incident response | done | [21-incident-response.md](21-incident-response.md) | README.md, PRODUCT.md, ops records |
| 22 | DORA | done (partial) | [22-dora.md](22-dora.md) | git log, gh run list, gh pr list |

Reused / linked docs (not copied): [README.md](../../README.md), [PRODUCT.md](../../PRODUCT.md),
[DOCPACK/00-product-card.md](../../DOCPACK/00-product-card.md), central
[ADR-0003 hosted shared services](https://github.com/bookchaowalit/architecture-docs/blob/main/docs/architecture/decisions/ADR-0003-hosted-shared-services.md).

Validate: `node ~/work/core22/tools/validate.mjs docs/diagrams/*.md docs/diagrams/08-adr/*.md`
