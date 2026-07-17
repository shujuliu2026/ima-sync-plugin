# Obsidian Community Plugins · 提交说明草稿

> **Plugin repo**: https://github.com/shujuliu2026/ima-sync-plugin  
> **提交入口（2026）**: [community.obsidian.md](https://community.obsidian.md) → Plugins → New plugin  
> **Release 目标**: `v1.5.60`（与 monorepo `manifest.json` 对齐；发 tag 前再核对）  
> **Date**: 2026-07-15

---

## 1. `community-plugins.json` 参考条目（目录已迁移，仅作文案参考）

```json
{
  "id": "ima-sync",
  "name": "IMA Sync",
  "author": "shujuliu",
  "description": "Push Obsidian notes to Tencent IMA knowledge base with incremental sync, attachments, and rate-limit handling.",
  "repo": "shujuliu2026/ima-sync-plugin"
}
```

---

## 2. 提交标题（若表单需要）

```text
IMA Sync — Obsidian to Tencent IMA knowledge base
```

---

## 3. 审核说明正文（复制粘贴）

```markdown
# IMA Sync

## Summary

- Pushes Obsidian Markdown notes (and local attachments) to **Tencent IMA** knowledge bases via the user's own API credentials.
- Incremental sync using content hashes; rate-limit friendly (configurable gaps, batch pauses, 429 backoff).
- **Desktop only** (`isDesktopOnly: true`).
- UI languages: Auto / 中文 / English.
- Optional Pro modules (license-gated): Trust verification, Govern audit, Format pre-push normalization — **core push remains free**.

## Repository

- https://github.com/shujuliu2026/ima-sync-plugin
- Latest release: https://github.com/shujuliu2026/ima-sync-plugin/releases（tag 须 = manifest.version）
- README: https://github.com/shujuliu2026/ima-sync-plugin/blob/main/README.en.md

## Third-party services

| Service | Purpose | Required? |
|---------|---------|-----------|
| **Tencent IMA** (`https://ima.qq.com`) | Upload notes & attachments to user's knowledge base | **Yes** (user-provided API Key + Client ID) |
| Author website | Optional sponsor QR image + MD5 integrity check | No (offline fallback UI) |
| Analytics endpoint | Optional anonymous usage stats | No (opt-in, default **off**) |

The plugin **does not** collect or transmit note body text, file paths, or API keys when telemetry is disabled (default).

When telemetry is enabled, events include: plugin version, language, sync run counts, error type counts — **never** note content or credentials.

## Network requests

- IMA OpenAPI (user-configured base URL, default `https://ima.qq.com`)
- Optional: sponsor PNG/MD5 from configured site host (about page only)
- Optional: analytics POST (only if user enables anonymous stats)

No background tracking without user action. No cryptocurrency miners or obfuscated code.

## Experimental features

Pull-from-cloud / full bidirectional sync are **hidden by default** and marked experimental in settings. Primary supported workflow is **Obsidian → IMA push only**.

## Checklist

- [x] I have read the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- [x] I have self-tested the latest release (230 automated tests + 14 stress tests + manual Obsidian smoke).
- [x] My plugin does not embed external scripts in note content.
- [x] Repository is public; release contains `main.js`, `manifest.json`, `styles.css`, `versions.json`.
- [x] `manifest.json` description is in English.
- [x] Plugin id matches folder name: `ima-sync`.

## Screenshots

<!-- Attach 1–2 screenshots before submitting: -->
<!-- 1. Settings → Connection (API URL, Key, KB ID) -->
<!-- 2. Sidebar with push actions + sync stats -->

## Author

- GitHub: shujuliu
- Email: shujuliu@foxmail.com
```

---

## 4. Pre-submit checklist

| Item | Action |
|------|--------|
| Public repo live | ✅ `shujuliu2026/ima-sync-plugin` |
| Release **v1.5.60**（或当时 HEAD version） | ⬜ 发 tag 后 CI 上传 main.js / manifest / styles / versions |
| Default branch manifest | ⬜ HEAD `version` 与 Release tag 一致（现 monorepo **1.5.60**） |
| Screenshots | ⬜ 1～2 张 PNG |
| community.obsidian.md | ⬜ 绑定 GitHub → New plugin → 填 repo URL |
| BRAT smoke test | 可选：上架前给内测者 |

---

## 5. Reviewer notes (optional comment)

```text
IMA is Tencent's knowledge-base product (China). Users must bring their own IMA API credentials;
the plugin is a client only and does not proxy keys through our servers.

Pull/sync-from-cloud is off by default (experimental). Happy to adjust description wording if needed.
```
