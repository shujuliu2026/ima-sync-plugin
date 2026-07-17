# IMA Sync · Obsidian Community 上架清单

> Phase 3 · IMA-P3 · 提交前人工核对  
> **官方入口（2026）**：[community.obsidian.md](https://community.obsidian.md) → Plugins → New plugin  
> 文档：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)

---

## 0. 当前状态（wikimap 侧 · 自动核对）

| 项 | 状态 |
|----|------|
| 公开仓库 `shujuliu2026/ima-sync-plugin` | ✅ 已存在 |
| 本地源码 `manifest.json` | ✅ **1.5.60**（本 monorepo） |
| 官网 downloads zip | ✅ **1.5.57**（`npm run tools:publish` 后再对齐源码） |
| GitHub Release | 以 [Releases](https://github.com/shujuliu2026/ima-sync-plugin/releases) 页为准；发版 tag 须 = `manifest.version` |
| `npm run chronicle:ima-sync-pregate` | ✅ 发版前必跑 |
| `npm run chronicle:ima-sync-pregate:quick` | ✅ 开发快测 ~2s |
| `README.en.md` · `LICENSE` | ✅ |
| community.obsidian.md 提交 | ⬜ 待发 Release 后由作者操作 |
| PR 说明草稿 | [`COMMUNITY-PR-DRAFT.md`](./COMMUNITY-PR-DRAFT.md) |
| 截图（设置页 + 侧栏） | ⬜ 提交前补 1～2 张 |

---

## 1. 仓库要求

| 项 | 说明 |
|----|------|
| 公开 GitHub 仓库 | `https://github.com/shujuliu2026/ima-sync-plugin` |
| 默认分支 `manifest.json` | **HEAD 上的 version 须与待审 Release tag 一致** |
| `main.js` | 单文件 bundle（`npm run bundle`），**非** `lib/` 源码 |
| Release 附件 | `main.js` · `manifest.json` · `styles.css` · `versions.json`（推荐 zip） |
| `README.md` | 根目录英文说明（可用 `README.en.md` 复制为 `README.md`） |
| `LICENSE` | 已含 |
| CI | `pregate.yml` + tag 触发 `release.yml` |

从 wikimap 导出独立仓库：

```bash
npm run chronicle:export-ima-sync-repo -- --out D:/repos/ima-sync-plugin
```

---

## 2. manifest.json 检查

| 字段 | 要求 | 当前 |
|------|------|------|
| `id` | `ima-sync`（与文件夹名一致） | ✅ |
| `name` | 英文可读 | `IMA Sync` |
| `description` | **英文**，≤200 字符 | ✅ |
| `version` | 与 changelog / Release tag 一致 | `1.5.60`（源码；官网 zip 见 downloads） |
| `minAppVersion` | 与 `versions.json` 一致 | `1.4.0` |
| `author` / `authorUrl` | 真实作者 | ✅ |
| `isDesktopOnly` | `true` | ✅ |

---

## 3. 提交流程（community.obsidian.md · 主路径）

### 3.1 先发 GitHub Release

Obsidian 从 **tag = manifest.version** 的 Release 下载安装包；默认分支 HEAD 上的 `manifest.json` 供目录审核读取。

```bash
cd scripts/chronicle/obsidian-plugin/ima-sync   # 或独立 clone 的 ima-sync-plugin
npm ci
npm run pregate
npm run bundle

# 确认 dist/manifest.json version = 当前待发版号（现源码 1.5.60）
git add manifest.json main.js styles.css versions.json   # 若根目录与 dist 同步策略见 release.yml
git commit -m "chore(release): v1.5.60"
git tag v1.5.60
git push origin main
git push origin v1.5.60
```

推送与 `manifest.version` 一致的 tag 后，`.github/workflows/release.yml` 会自动 pregate → bundle → 创建 Release 并上传附件。

**wikimap 宿主发版（网站下载 zip）**：

```bash
npm run chronicle:ima-sync-pregate
npm run tools:publish   # → apps/web/public/downloads/ima-sync/ima-sync-v*.zip
```

### 3.2 在 community.obsidian.md 提交

1. 打开 [community.obsidian.md](https://community.obsidian.md)，用 **Obsidian 账号**登录  
2. 个人资料 **绑定 GitHub**（须为仓库所有者）  
3. 侧栏 **Plugins → New plugin**  
4. 填写仓库 URL：`https://github.com/shujuliu2026/ima-sync-plugin`  
5. 勾选开发者政策，承诺持续维护  
6. **Submit**

审核说明、第三方服务与隐私文案见 [`COMMUNITY-PR-DRAFT.md`](./COMMUNITY-PR-DRAFT.md)（复制到表单备注或审核回复）。

### 3.3 审核反馈后

- 改仓库 / Release → **升 version** → 新 tag → 在目录里 **Publish**  
- 本地回归：`npm run chronicle:ima-sync-pregate`

---

## 4. 旧流程（obsidian-releases PR · 已弃用）

2026 年起官方推荐 **community.obsidian.md** 目录提交，一般**不再**需要 fork `obsidianmd/obsidian-releases`。

若审核员仍要求 JSON 条目，可参考 `COMMUNITY-PR-DRAFT.md` §1 的 `community-plugins.json` 片段作为描述参考。

---

## 5. BRAT（Beta · 上架前内测）

1. 测试者安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)  
2. **Settings → BRAT → Add Beta plugin**  
3. 粘贴 `product-manifest.json` → `distribution.brat.repoUrl`  
4. 选择 `main` 或与当前 Release 一致的 `v*` tag，验证 bundle 安装与推送  

---

## 6. 自动更新 · versions.json

社区安装后，Obsidian 读取 Release 中的 `manifest.json` + `versions.json` 提示更新。

每次 bump version：

```bash
npm run pregate
npm run bundle          # 内含 sync-versions
git tag vX.Y.Z
git push origin vX.Y.Z
```

`versions.json` 由 `npm run sync-versions` 从 changelog 生成；**每次改 version 后必须重新 bundle**。

---

## 7. Pro License（不锁核心）

| 原则 | 说明 |
|------|------|
| Free | 推送 / 附件 / 多 KB **不锁** |
| Pro | Trust · Govern · Format 等增值模块（见 changelog） |
| 赞赏 QR | 自愿支持，**不**解锁功能 |

见 `product-manifest.json` → `license.proTier`。

---

## 8. Analytics 独立租户

Fork / 独立实例时在 `product-manifest.json` 设置 `analytics.tenantId` 等。详见 [`ANALYTICS-TENANT.md`](./ANALYTICS-TENANT.md)。

---

## 9. 提交前截图建议

| # | 画面 |
|---|------|
| 1 | **Settings → Connection**：API URL、Key、知识库 ID |
| 2 | **侧栏**：推送按钮、同步统计、Trust/Format 区块（如有） |

保存为 PNG，附在审核说明或论坛 Showcase 帖。
