# 06 — C4 Container

```mermaid
C4Container
  title Containers of platform-mcp-remote-worker
  System_Ext(claude, "Claude Code", "HTTP MCP client")
  System_Ext(codex, "Codex", "stdio MCP client")
  Container_Boundary(repo, "platform-mcp-remote-worker") {
    Container(worker, "MCP Worker", "TypeScript, Cloudflare Workers, MCP SDK 1.32.1", "src/worker.ts: /mcp and /healthz")
    Container(launch, "launch.py", "Python 3", "Resolves token from Infisical /mcp then execs bridge")
    Container(bridge, "bridge.mjs", "Node, MCP SDK", "stdio server to remote HTTP client")
    Container(manage, "manage.py", "Python 3 stdlib + vendor/secret_resolver.py", "status, bootstrap, deploy, configure")
    Container(smoke, "verify.py + smoke.mjs", "Python + Node", "Live metadata-only smoke")
  }
  System_Ext(infisical, "Infisical", "Secrets")
  System_Ext(cloudflare, "Cloudflare API and Wrangler", "Deploy and secret bulk")
  System_Ext(gateway, "Edge gateway", "Cell routes")
  System_Ext(identity, "platform-identity", "/v1/token")

  Rel(claude, worker, "POST /mcp")
  Rel(codex, launch, "spawns")
  Rel(launch, infisical, "get SOLO_MCP_REMOTE_TOKEN")
  Rel(launch, bridge, "exec")
  Rel(bridge, worker, "POST /mcp")
  Rel(manage, infisical, "resolve secrets")
  Rel(manage, cloudflare, "workers subdomain, deploy, secret bulk")
  Rel(smoke, worker, "no-auth 401, list and call tools")
  Rel(worker, gateway, "fetch, redirect manual")
  Rel(worker, identity, "fetch token")
```

Sources: package.json, src/worker.ts, launch.py, bridge.mjs, manage.py, verify.py, smoke.mjs, vendor/secret_resolver.py

Worker ไม่มี binding อื่น (ไม่มี KV/D1/R2/DO/Queue/cron ใน wrangler.toml) state เดียวคือ in-memory cache ต่อ isolate

## Open questions

- ไม่มี
