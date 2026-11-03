# 11 — State machines

ไม่มี entity ที่ persist พร้อม status field lifecycle ที่มีจริงในโค้ดคือ (1) readiness ของ Worker ตาม config,
(2) platform token cache ต่อ audience, (3) ผลของ `call_cell` ตามลำดับ guard

## Worker readiness

```mermaid
stateDiagram-v2
  [*] --> NotConfigured: deploy without MCP_TOKEN_SHA256 or PUBLIC_ORIGIN
  NotConfigured --> Ready: secret bulk sets hash and deploy sets PUBLIC_ORIGIN var
  Ready --> NotConfigured: plain wrangler deploy drops PUBLIC_ORIGIN
  Ready --> Ready: request served
  NotConfigured: healthz and mcp answer 503 not_configured
  Ready: healthz 200, mcp checks auth
```

## Platform token cache (per clientId and audience, per isolate)

```mermaid
stateDiagram-v2
  [*] --> Empty
  Empty --> Fetching: call_cell on platform cell
  Fetching --> Valid: identity returns access_token and expires_in
  Fetching --> Empty: TokenError or bad JSON, token_error
  Valid --> Valid: reuse while expires beyond now plus 30 s
  Valid --> Fetching: within 30 s of expiry
  Valid --> Empty: new isolate or resetPlatformTokens
```

## call_cell result

```mermaid
stateDiagram-v2
  [*] --> Validate
  Validate --> unknown_cell: name not in CELLS
  Validate --> method_not_allowed: not GET POST PATCH PUT
  Validate --> read_only: MCP_READONLY and not GET
  Validate --> invalid_path: cellPath or cellUrl fails
  Validate --> invalid_request: GET with body
  Validate --> body_too_large: over 64 KiB
  Validate --> not_configured: missing token or identity key
  Validate --> Calling: all guards pass
  Calling --> token_error: identity refused
  Calling --> timeout: 15 s deadline
  Calling --> response_too_large: over 2 MiB
  Calling --> upstream_error: fetch failed
  Calling --> invalid_response: not JSON
  Calling --> http_error: non-2xx
  Calling --> ok: 2xx JSON or 204
```

Sources: src/worker.ts (`handleRequest` healthz, `platformToken`, `TOKEN_REFRESH_MARGIN_SECONDS`, `callCell`,
`errorStatuses`), manage.py (`deploy`), ops record: api-gateway-edge (2026-11-03) for the PUBLIC_ORIGIN drop

## Open questions

- ไม่มี
