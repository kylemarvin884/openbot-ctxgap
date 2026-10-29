# 贡献指南

## 安装

本仓库用 corepack + pnpm，不要用 `npm install`：workspace 协议（`workspace:*`）
npm 不支持，会直接报 EUNSUPPORTEDPROTOCOL。

```bash
corepack enable
pnpm install
```

## 测试

```bash
pnpm test
```
