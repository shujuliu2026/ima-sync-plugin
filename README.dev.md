# IMA Sync · 开发者指南（monorepo 宿主）

> 面向在 **wikimap** 等 monorepo 内维护插件的开发者。  
> 终端用户请阅 [`README.md`](README.md)。

---

## 源码位置

| 路径 | 说明 |
|------|------|
| `scripts/chronicle/obsidian-plugin/ima-sync/` | 插件源码 |
| `product-manifest.json` | 产品身份 SSOT（品牌 / URL / Analytics） |
| `lib/product-config.js` | 运行时读取 manifest |
| `lib/brand-strings.js` | i18n 白标覆盖 |
| `fixtures/product-manifest.test.json` | 白标 selftest 夹具 |

设计文档：`docs/design/ima-sync-product/`

---

## 开发闭环

脚本 SSOT 位于 `scripts/`（独立 repo 与 wikimap 内嵌共用）。

在 **wikimap 根目录**（默认内嵌路径）：

```bash
npm run chronicle:ima-sync-pregate       # 功能自测 + 压力测试（发版前必过）
npm run chronicle:ima-trust-probe        # Trust 真机探针（须 .env 配 IMA_*）
npm run chronicle:bundle-ima-sync        # 打包 dist/
npm run chronicle:install-ima-sync -- --vault D:/你的Obsidian库路径
npm run chronicle:export-ima-sync-repo -- --out D:/repos/ima-sync-plugin
```

在 **独立 repo 根目录**（`ima-sync-plugin`）：

```bash
npm ci
npm run pregate                          # selftest + stresstest
npm run bundle
npm run install-plugin -- --vault D:/你的Obsidian库路径
```

### 引用外部 clone（wikimap 宿主）

```bash
# 环境变量（推荐，适用于 pregate 等复合脚本）
set IMA_SYNC_ROOT=D:\repos\ima-sync-plugin
npm run chronicle:ima-sync-pregate
npm run chronicle:install-ima-sync -- --vault D:\obsidian
IMA_SYNC_ROOT=D:\repos\ima-sync-plugin npm run tools:publish

# 或单次 --src（bundle/selftest/stresstest 包装器）
npm run chronicle:bundle-ima-sync -- --src D:/repos/ima-sync-plugin
```

| 脚本 | 说明 |
|------|------|
| `chronicle:ima-sync-selftest` | 功能自测（含 TC-PROD-* · TC-REPO-*） |
| `chronicle:ima-sync-stresstest` | 规模/压力 mock 自测 |
| `chronicle:ima-trust-probe` | Trust 真机：`check_repeated_names` + `search_knowledge` |
| `chronicle:bundle-ima-sync` | esbuild 单文件 + 复制 manifest/assets |
| `chronicle:install-ima-sync` | 安装 dist/ 到 Obsidian vault |
| `chronicle:export-ima-sync-repo` | 导出可 `git init` 的独立仓库目录 |

勿将未打包的 `lib/` 源码直接复制到 Obsidian 插件目录；安装脚本使用 `dist/` 单文件 bundle。

---

## 社区上架（Phase 3）

| 文档 | 内容 |
|------|------|
| [`README.en.md`](README.en.md) | 英文用户说明 |
| [`docs/COMMUNITY.md`](docs/COMMUNITY.md) | Community / BRAT 提交清单 |
| [`docs/ANALYTICS-TENANT.md`](docs/ANALYTICS-TENANT.md) | 独立 Analytics 租户 |
| `versions.json` | `npm run sync-versions` · bundle 自动生成 |
| `.github/workflows/release.yml` | tag 触发 GitHub Release |

---

## CI

| Workflow | 触发 | 内容 |
|----------|------|------|
| `.github/workflows/ima-sync.yml` | 仅 ima-sync 路径变更 | `chronicle:ima-sync-pregate` |
| `.github/workflows/build.yml` | main PR/push | 全站 M10 gate（含 ima-sync-selftest） |

---

## 白标 / Fork

1. 复制并修改 `product-manifest.json`（品牌名、siteHost、aboutDesc、赞赏资源路径等）
2. 部署赞赏 QR 到 `{siteHost}{distribution.sponsorAssetPath}/`
3. 跑 `npm run chronicle:ima-sync-selftest` — TC-PROD-06～13 使用 `fixtures/product-manifest.test.json` 校验机制
4. 真机验证关于页与赞赏 URL 指向新 host

---

## Cursor Agent Skill

`D:\projects\skills\ima-sync-plugin\`（或本机 skills 目录）

| 文档 | 内容 |
|------|------|
| `SKILL.md` | 开发闭环 · 发版 Checklist |
| `architecture.md` | 模块 · 反馈 · 赞赏 |
| `testing.md` | 打包前自测 + 压力测试 |
| `reference.md` | API · 排错 · npm 脚本 |

---

## Analytics Hub（可选 · 运营侧）

插件端契约见 `lib/telemetry.js`（`ima.*` 事件 · `client_channel` 来自 manifest）。

```bash
npm run analytics:api          # :8059 采集
npm run analytics:hub          # :8071 多工具统计页
npm run ima-sync:stats:seed    # IMA Sync 演示数据
```

详见 `scripts/ima-sync-analytics/README.md`。

---

## 与编史集 chronicle-panel 的关系

- **chronicle-panel**：依赖本机 `chronicle:panel`（:8060），走编史工作流闸门
- **ima-sync**：直连 IMA，可并存，互不依赖

---

## Pro Trust · 真机验收

| 步骤 | 命令 / 操作 |
|------|-------------|
| Mock 回归 | `npm run chronicle:ima-sync-pregate` |
| 真机探针 | `npm run chronicle:ima-trust-probe` → `docs/records/IMA-Trust-真机探针-latest.json` |
| Obsidian | 设置 → Pro → **测试 Trust API** |
| 手测 | [IMA-Sync-Trust-E2E.md](../../../docs/testing/IMA-Sync-Trust-E2E.md) |

**`.env` 须配**：`IMA_API_URL` · `IMA_CLIENT_ID` · `IMA_API_KEY` · `IMA_KB_ID`（腾讯 ima.qq.com）

**常见失败 `skill auth failed`**：见 [04-IMA-OpenAPI凭据配置.md](../../../docs/design/ima-sync-product/04-IMA-OpenAPI凭据配置.md) — **不是改代码，是换控制台 Key**。

可选：`IMA_TRUST_PROBE_TITLE=库内已知标题` 验证检索命中。

---

## 里程碑

独立 **IMA-Px**（不占 M9～M24）：

| 期 | 代号 | 状态 |
|----|------|------|
| IMA-P0 | 预埋 · product-manifest | ✅ |
| IMA-P1 | 白标 · 独立 CI | ✅ |
| IMA-P2 | 独立 git 仓库 | ✅ |
| IMA-P3 | 社区上架 · versions.json | ✅ |
| IMA-Pro-1 | Trust Beta · v1.5.39 | 🟡 pregate ✅ · 凭据待用户配置 |
