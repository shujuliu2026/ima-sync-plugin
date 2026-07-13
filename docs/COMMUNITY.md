# IMA Sync · Obsidian Community 上架清单

> Phase 3 · IMA-P3 · 提交前人工核对

---

## 1. 仓库要求

| 项 | 状态 |
|----|------|
| 公开 GitHub 仓库 `ima-sync-plugin` | 待创建 / 已 export |
| `main.js` 单文件 bundle（非 `lib/` 源码） | `npm run bundle` |
| `manifest.json` · `styles.css` · `versions.json` 在 release 根 | bundle 产出 |
| `README.en.md` 英文说明 | ✅ |
| `LICENSE` | ✅ |
| CI pregate PASS | `.github/workflows/pregate.yml` |

---

## 2. manifest.json 检查

| 字段 | 要求 |
|------|------|
| `id` | `ima-sync`（与文件夹名一致） |
| `name` | 英文可读，如 `IMA Sync` |
| `description` | **英文**，≤200 字符，说明核心功能 |
| `version` | 与 `changelog.js` / tag 一致 |
| `minAppVersion` | 与 `versions.json` 值一致 |
| `author` / `authorUrl` | 真实作者 |
| `isDesktopOnly` | `true`（无 mobile API） |

---

## 3. 提交流程（obsidianmd/obsidian-releases）

1. Fork [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
2. 编辑 `community-plugins.json`，追加：

```json
{
  "id": "ima-sync",
  "name": "IMA Sync",
  "author": "shujuliu",
  "description": "Push Obsidian notes to Tencent IMA knowledge base with incremental sync and attachments.",
  "repo": "shujuliu2026/ima-sync-plugin"
}
```

3. 打开 PR，填写 checklist（截图、隐私说明、无恶意网络请求等）
4. 审核通过后用户可在 Obsidian 社区插件浏览安装

**注意**：IMA 为腾讯服务；description 中说明需用户自配 API Key，插件不代管凭证。

---

## 4. BRAT（Beta 测试 · 上架前）

1. 测试者安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. **Settings → BRAT → Add Beta plugin**
3. 粘贴 `product-manifest.json` → `distribution.brat.repoUrl`
4. 选择 `main` 或 release tag，验证 bundle 安装与推送

---

## 5. 自动更新 · versions.json

Obsidian 社区安装后，官方从 release 读取 `manifest.json` + `versions.json`。

发版步骤：

```bash
npm run pregate
npm run bundle          # 内含 sync-versions
git tag v1.5.38
git push origin v1.5.38
# GitHub Release 附件：main.js, manifest.json, styles.css, versions.json
```

`versions.json` 由 `npm run sync-versions` 从 changelog 生成；**每次 bump version 后必须重新 bundle**。

---

## 6. Pro License（规划 · 不锁核心）

| 原则 | 说明 |
|------|------|
| Free | 推送 / 附件 / 多 KB **不锁** |
| Pro（远期） | 团队模板 · 优先支持 · 白标 manifest 工具 |
| 赞赏 QR | 自愿支持，**不**解锁功能 |

见 `product-manifest.json` → `license.proTier`。

---

## 7. Analytics 独立租户

Fork / 独立实例时在 `product-manifest.json` 设置：

```json
"analytics": {
  "tenantId": "your-instance-id",
  "clientChannel": "ima-sync-yourbrand",
  "defaultEventsUrl": "https://your-host/analytics/events"
}
```

Hub 协议与 wikimap `ima-sync-analytics` 兼容；租户分离，默认 opt-in。详见 [`ANALYTICS-TENANT.md`](./ANALYTICS-TENANT.md)。
