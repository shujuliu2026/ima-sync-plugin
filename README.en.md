# IMA Sync

Push Obsidian notes to **Tencent IMA** knowledge bases with incremental content hashing, attachment upload, rate-limit backoff, and optional anonymous usage stats.

No CMS or website backend required — connects directly to the IMA OpenAPI using the user's own API credentials.

> Branding and URLs come from `product-manifest.json` (white-label forks change one file).  
> Maintainer / monorepo docs: [`README.dev.md`](README.dev.md).

---

## Install

### Option A · GitHub Releases (recommended for beta)

1. Download `ima-sync-v*.zip` from [Releases](https://github.com/shujuliu/ima-sync-plugin/releases).
2. Extract into `<vault>/.obsidian/plugins/ima-sync/` (`main.js`, `manifest.json`, `styles.css` required).
3. Enable **Settings → Community plugins → IMA Sync**, then reload Obsidian (Ctrl+R).

### Option B · BRAT (beta testers)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) in Obsidian.
2. **Add Beta plugin** → paste repository URL from `product-manifest.json` → `distribution.brat.repoUrl`.
3. Enable IMA Sync and reload.

### Option C · Manual dist copy

Copy a built `dist/` folder into `.obsidian/plugins/ima-sync/`. Do **not** install the raw `lib/` source tree — Obsidian needs the single-file `main.js` bundle.

---

## Quick setup

1. **Connection**: API URL → **API Key + Client ID** → knowledge base ID → refresh sidebar to test.
2. **Sync**: pick folders, auto-sync interval (0 = off), optional pause.
3. **Advanced** (optional): experimental pull, upload gap, batch pause, 429 backoff, network retry, mock mode.

For Tencent IMA use `https://ima.qq.com` with both Client ID and API Key.

---

## Features

| Feature | Description |
|---------|-------------|
| **Push to IMA** | Main path: upload notes + attachments; skip unchanged via content hash |
| **Sync current note** | Push the open note (ignores folder filter) |
| **Sync folder** | Push a chosen folder or the current note's folder |
| **Pull from IMA** | **Experimental · off by default** — may overwrite local notes |
| **Full sync** | **Experimental · off by default** — push + pull |
| **Pause / stop** | Pause between files or stop a batch run |
| **Attachments** | Resolves `![[…]]` / `![](…)` local references |
| **Conflict handling** | Dialog or default strategy when both sides changed |
| **Retry / reconnect** | Network retry with backoff; periodic reconnect probe |
| **Quota / rate limits** | Friendly notices when daily quota or 429 limits hit |

> **Experimental pull** is hidden until **Advanced → Enable pull from cloud (experimental)**. Daily use: **push only**.

---

## Rate limits (IMA reference)

| Type | Notes |
|------|-------|
| **QPS** | ~5 req/s; 429 → wait 1–5 minutes |
| **Daily** | Safe ≤5000/day in practice |
| **Plugin defaults** | 500ms gap · 80 notes/batch · 30s batch pause · 429 backoff 60→120→300s |

---

## Language

**Settings → Language**: Auto / 中文 / English.

---

## License

**Free download.** Commercial redistribution requires written permission from the copyright holder. See [`LICENSE`](LICENSE).

Optional Alipay sponsor QR loads from the configured site host — voluntary support only, **not** a license grant.

---

## Privacy

Anonymous telemetry (version, active days, success rate, error counts) is **on by default**. **Never** uploads API keys, note paths, or body text. Turn off in **Feedback & improve** if you prefer.

---

## Feedback

Sidebar **Feedback & improve**: local diagnostics summary, copy diagnostics, telemetry toggle (on by default).

---

Bilingual Obsidian plugin · Obsidian → Tencent IMA knowledge base sync.
