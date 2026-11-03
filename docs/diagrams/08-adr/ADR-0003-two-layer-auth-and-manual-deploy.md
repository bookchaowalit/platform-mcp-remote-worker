# ADR-0003 — Two-layer auth (hashed client token + delegated cell tokens) and secret-safe manual deploy

- Status: accepted (retro-documented)
- Date of evidence: 2026-10-04 (client token), 2026-10-18 (owner-mcp), 2026-11-03 (identity client `mcp-hub`)

## Context

hub ต้องให้ agent เข้าถึงได้โดย token ไม่ถูกเขียนลง config และ Worker ต้องเรียก cell ด้วยสิทธิ์ที่ cell ตรวจเองได้

## Decision

1. Client layer: Worker เก็บเฉพาะ `MCP_TOKEN_SHA256` และเทียบแบบ constant-time; token จริงอยู่ใน Infisical `/mcp`
   (`manage.py worker_secrets` ส่ง hash ไม่ใช่ token)
2. Cell layer: own cells ใช้ delegated JWT `owner-mcp` (`EMPIRE_OWNER_MCP_TOKEN`) ที่ hosted rotation job push ทุกสัปดาห์;
   `platform-*` cells ใช้ identity service client `mcp-hub` (`client_credentials` + `private_key_jwt` RS256, key
   `IDENTITY_CLIENT_PRIVATE_KEY_PEM` จาก Infisical `/mcp-hub`) ขอ token ต่อ audience พร้อม scope ของเจ้าของเท่านั้น
   (payment อ่านอย่างเดียว) และส่ง `X-Empire-Channel: mcp`
3. Deploy ด้วยมือผ่าน `manage.py deploy` เท่านั้น: `wrangler deploy --var PUBLIC_ORIGIN:<origin>` แล้ว `secret bulk` ทาง stdin;
   ไม่พิมพ์ output ของ provider; CI ไม่มี Cloudflare credentials และไม่ deploy

## Evidence

src/worker.ts (`authorized`, `platformToken`, `PLATFORM_CELLS`, `CELL_CHANNEL`), manage.py (`worker_secrets`, `deploy`,
`fixed_command`), .github/workflows/ci.yml comment "CI never deploys", tests/manage_test.py, PRODUCT.md,
ops record: book-platforms-status (2026-11-03), ops record: api-gateway-edge (2026-11-03)

## Consequences

- token เดียวให้สิทธิ์ทุก cell ตาม scope ของ owner-mcp (PRODUCT.md risk)
- `manage.py deploy` push secrets ใหม่จาก Infisical ด้วย; ops record ระบุว่าไม่ควรใช้แค่เพื่อ redeploy เพราะทับ
  owner-mcp token ที่ rotation push ไว้ — redeploy code-only ใช้ `wrangler deploy --var PUBLIC_ORIGIN:<origin>`
