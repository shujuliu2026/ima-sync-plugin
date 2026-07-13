'use strict'

/**
 * 等待 Obsidian 布局 + metadata 索引就绪后再做全库扫描/连接探测
 * @param {import('obsidian').App} app
 */
function createVaultReadyGate (app) {
  let ready = false
  let layoutReady = false
  let metaReady = false
  /** @type {(() => void)[]} */
  const waiters = []

  function tryResolve () {
    if (ready || !layoutReady || !metaReady) return
    ready = true
    const list = waiters.splice(0)
    for (const fn of list) fn()
  }

  function markLayoutReady () {
    layoutReady = true
    tryResolve()
  }

  function markMetaReady () {
    metaReady = true
    tryResolve()
  }

  return {
    isReady () {
      return ready
    },

    /**
     * @param {{ timeoutMs?: number }} [opts]
     * timeoutMs>0 时超时后仍 resolve，避免侧栏刷新按钮永久转圈
     */
    whenReady (opts = {}) {
      if (ready) return Promise.resolve()
      const timeoutMs = Math.max(0, Number(opts.timeoutMs) || 0)
      const wait = new Promise((resolve) => { waiters.push(resolve) })
      if (!timeoutMs) return wait
      return Promise.race([
        wait,
        new Promise((resolve) => { window.setTimeout(resolve, timeoutMs) })
      ])
    },

    /** @param {import('obsidian').Plugin} plugin */
    bind (plugin) {
      plugin.registerEvent(app.workspace.onLayoutReady(() => {
        markLayoutReady()
      }))

      // metadataCache.onReady 非公开 API，重载插件后常不触发 → 用 resolved + 同步探测
      plugin.registerEvent(app.metadataCache.on('resolved', () => {
        markMetaReady()
      }))

      // 重载插件时 layout / metadata 可能已就绪，事件不再触发
      if (app.workspace?.layoutReady) {
        layoutReady = true
      }
      if (probeMetadataReady(app)) {
        metaReady = true
      }

      tryResolve()

      // 兜底：避免侧栏永久「库索引加载中…」（大库 resolved 延迟或事件遗漏）
      const fallbackMs = 8000
      const timer = window.setTimeout(() => {
        if (ready) return
        layoutReady = true
        metaReady = true
        tryResolve()
      }, fallbackMs)
      plugin.register(() => window.clearTimeout(timer))
    }
  }
}

/**
 * metadata 是否已可用（重载插件时通常已为 true）
 * @param {import('obsidian').App} app
 */
function probeMetadataReady (app) {
  const files = app.vault.getMarkdownFiles()
  if (files.length === 0) return true
  const sample = Math.min(8, files.length)
  let cached = 0
  for (let i = 0; i < sample; i++) {
    const idx = Math.floor(i * files.length / sample)
    if (app.metadataCache.getFileCache(files[idx])) cached++
  }
  return cached >= Math.max(1, Math.ceil(sample / 2))
}

module.exports = { createVaultReadyGate, probeMetadataReady }
