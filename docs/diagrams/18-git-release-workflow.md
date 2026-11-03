# 18 — Git and release workflow

จาก `git log --graph`: งานเข้าทาง feature branch แล้ว merge เข้า `main` (PR #1 (squash) และ #2–#4 (merge commit) บน GitHub และ merge local เช่น
`321b8a5 Merge branch platform-cells`) รวมถึง commit ตรงบน main (เช่น `cc8492d`, `0a0e32d`) ไม่มี tag หรือ release
version ใน git (`package.json` version 1.0.0 ตายตัว) การ release = deploy มือหลัง CI

```mermaid
gitGraph
  commit id: "f84f878 host remote tools"
  commit id: "ec15aec vendor resolver"
  commit id: "2154bce shared CI, PR 1 squash"
  branch feat-tool-hub-cells
  commit id: "2084841 tool hub"
  commit id: "05a1be7 docs"
  checkout main
  merge feat-tool-hub-cells id: "915bc01 PR 2"
  branch ci-gitleaks
  commit id: "5ef3446"
  checkout main
  merge ci-gitleaks id: "4c78cd2 PR 3"
  commit id: "5b78646 Sentry"
  commit id: "5c9f721 deps"
  branch offers-cell
  commit id: "d9d3386"
  commit id: "460a5ab deps"
  checkout main
  merge offers-cell id: "5ab914a PR 4"
  commit id: "cc8492d via gateway"
  branch platform-cells
  commit id: "dcf6d15"
  commit id: "910bc78"
  checkout main
  merge platform-cells id: "321b8a5"
  commit id: "0a0e32d payment read only"
```

```mermaid
flowchart LR
  b["Branch or direct commit"] --> pr{"PR?"}
  pr -- "yes" --> ci1["CI on pull_request"]
  pr -- "no, local merge" --> main
  ci1 --> main["main"]
  main --> ci2["CI on push to main"]
  ci2 --> dep["Owner runs manage.py deploy or wrangler deploy --var PUBLIC_ORIGIN"]
  dep --> ver["verify.py smoke"]
  ver --> live["Live Worker"]
```

หมายเหตุ: deploy ไม่ได้ถูก gate โดย CI ทางเทคนิค (เป็นขั้นมือ) — main `321b8a5` และ `0a0e32d` ถูกใช้ live ตาม ops record
ขณะ CI แดงที่ `scripts`

Sources: `git log --graph --oneline origin/main`, `gh pr list --state all`, .github/workflows/ci.yml, PRODUCT.md,
ops record: book-platforms-status (2026-11-03)

## Open questions

- ควรบังคับ "CI green ก่อน deploy" (เช่น script ตรวจ `gh run` ใน `manage.py`) หรือไม่
- ไม่มี branch protection ที่ตรวจได้จาก repo files
