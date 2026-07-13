# IMA Sync · 独立仓库初始化

> 由 `npm run chronicle:export-ima-sync-repo` 从 wikimap 导出 · 2026-07-13

## 1. 初始化 git

```bash
cd ima-sync-export-v1544
git init
npm ci
npm run pregate
```

## 2. 推送到 GitHub

```bash
git remote add origin git@github.com:YOUR_ORG/ima-sync-plugin.git
git add .
git commit -m "chore: initial import from wikimap Phase 2 export"
git push -u origin main
```

## 3. wikimap 宿主引用外部仓库

```bash
# clone 到任意路径后
IMA_SYNC_ROOT=D:/repos/ima-sync-plugin npm run chronicle:ima-sync-pregate
IMA_SYNC_ROOT=D:/repos/ima-sync-plugin npm run chronicle:install-ima-sync -- --vault D:/obsidian

# 或 submodule
git submodule add https://github.com/YOUR_ORG/ima-sync-plugin.git vendor/ima-sync-plugin
npm run chronicle:install-ima-sync -- --src vendor/ima-sync-plugin --vault D:/obsidian
```

## 4. 临忆录官网发布

在 wikimap 根目录（默认实例仍从 vendor 或本地镜像 dist 发布）：

```bash
IMA_SYNC_ROOT=D:/repos/ima-sync-plugin npm run tools:publish
```

详见 wikimap `docs/design/ima-sync-product/03-与临忆录关系.md`
