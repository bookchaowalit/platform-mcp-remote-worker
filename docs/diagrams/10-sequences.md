# 10 — Sequence diagrams

## S1 — MCP request: auth and transport

```mermaid
sequenceDiagram
  participant C as Agent client
  participant W as Worker handleRequest
  participant S as McpServer (fresh)
  C->>W: POST /mcp with Authorization Bearer and JSON body
  W->>W: MCP_TOKEN_SHA256 and PUBLIC_ORIGIN configured, else 503
  W->>W: URL origin and Host equal PUBLIC_ORIGIN, else 403
  W->>W: Origin header absent or in ALLOWED_ORIGINS, else 403
  W->>W: SHA-256 of token, constant-time compare, else 401
  W->>W: method POST (405), content-type JSON (415), body up to 64 KiB (413 or 400)
  W->>S: serverFor(env) then connect WebStandardStreamableHTTPServerTransport
  S-->>W: JSON-RPC response
  W-->>C: response with Cache-Control no-store and nosniff
  W->>S: close
```

## S2 — call_cell to an own cell (owner-mcp)

```mermaid
sequenceDiagram
  participant A as Agent
  participant H as call_cell
  participant G as gateway.bookchaowalit.com
  participant K as Cell API
  A->>H: cell, method, path, query, body
  H->>H: cell known, method allowed, MCP_READONLY, cellPath, no GET body, body up to 64 KiB
  H->>H: EMPIRE_OWNER_MCP_TOKEN present, else not_configured
  H->>G: method /v1/system/v1/... Bearer owner-mcp, X-Empire-Channel mcp, redirect manual, 15 s
  G->>K: forward
  K-->>G: JSON
  G-->>H: JSON up to 2 MiB
  H->>H: redact then fitResponse to 100 KiB
  H-->>A: status, http_status, data or truncated preview
```

## S3 — call_cell to a platform-* service (identity client)

```mermaid
sequenceDiagram
  participant A as Agent
  participant H as call_cell
  participant I as platform-identity /v1/token
  participant G as Edge gateway
  participant P as Platform service
  A->>H: cell platform-x, method, path
  H->>H: IDENTITY_CLIENT_PRIVATE_KEY_PEM PKCS8 and IDENTITY_CLIENT_ID valid, else not_configured
  alt cached token valid beyond 30 s margin
    H->>H: reuse token
  else
    H->>H: sign RS256 assertion, lifetime 60 s
    H->>I: POST client_credentials, audience, owner scopes, client_assertion
    I-->>H: access_token, expires_in
    H->>H: cache by clientId and audience
  end
  H->>G: request with Bearer platform token and X-Empire-Channel mcp
  G->>P: forward
  P-->>H: JSON via gateway
  H-->>A: redacted result
  Note over H,I: identity refusal returns token_error with status only
```

## S4 — describe_cell

```mermaid
sequenceDiagram
  participant A as Agent
  participant D as describeCell
  participant G as Edge gateway
  A->>D: cell
  alt cache hit within 5 min
    D-->>A: cached result with cached true
  else
    D->>G: GET base/openapi.json without token, redirect manual
    G-->>D: OpenAPI JSON up to 2 MiB
    D->>D: scrub secrets, compactOperations, cap 48 KiB
    D-->>A: operations, omitted_operations, truncated
  end
```

Sources: src/worker.ts (`handleRequest`, `authorized`, `callCell`, `platformToken`, `describeCell`, `fitResponse`),
ops record: api-gateway-edge (2026-11-03) for the gateway's tokenless openapi.json route

## Open questions

- ไม่มี
