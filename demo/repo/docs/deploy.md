# 部署到 staging

部署脚本是 `scripts/deploy.mjs`。运行前必须先导出 `API_BASE`，否则脚本会抛
`MISSING_API_BASE` 并退出：

```bash
export API_BASE=https://staging.internal.example/v1
node scripts/deploy.mjs
```

`API_BASE` 的值找平台组要，不要写进仓库。
