# Obsidian Community Plugins · PR Draft

> **Plugin repo**: https://github.com/shujuliu2026/ima-sync-plugin  
> **Target**: [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)  
> **Date**: 2026-07-12

---

## 1. `community-plugins.json` entry

Add alphabetically by `id` (after `image-*`, before `im-*` or as appropriate):

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

## 2. PR title

```text
Add plugin: IMA Sync
```

---

## 3. PR body (copy-paste)

```markdown
# IMA Sync

## Summary

- Pushes Obsidian Markdown notes (and local attachments) to **Tencent IMA** knowledge bases via the user's own API credentials.
- Incremental sync using content hashes; rate-limit friendly (configurable gaps, batch pauses, 429 backoff).
- **Desktop only** (`isDesktopOnly: true`).
- UI languages: Auto / 中文 / English.

## Repository

- https://github.com/shujuliu2026/ima-sync-plugin
- Latest release: https://github.com/shujuliu2026/ima-sync-plugin/releases/latest
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
- [x] I have self-tested the latest release (119 automated tests + manual Obsidian smoke).
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
| Public repo live | Push `main` to GitHub |
| Release `v1.5.38` | Contains main.js, manifest.json, styles.css, versions.json |
| Screenshots | Add to PR body |
| Fork obsidian-releases | Edit `community-plugins.json` only |
| BRAT smoke test | Optional beta before community merge |

---

## 5. Reviewer notes (optional comment)

```text
IMA is Tencent's knowledge-base product (China). Users must bring their own IMA API credentials;
the plugin is a client only and does not proxy keys through our servers.

Pull/sync-from-cloud is off by default (experimental). Happy to adjust description wording if needed.
```
