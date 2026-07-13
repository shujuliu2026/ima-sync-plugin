import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 插件仓库根目录（独立 repo 或 wikimap 内嵌）。
 * 可通过环境变量 IMA_SYNC_ROOT 或 CLI --src 覆盖。
 */
export function resolvePluginRoot (override) {
  const raw = override || process.env.IMA_SYNC_ROOT
  if (raw) return path.resolve(raw)
  return path.join(__dirname, '..')
}

/** @param {string} [override] */
export function getPaths (override) {
  const pluginRoot = resolvePluginRoot(override)
  return {
    pluginRoot,
    distDir: path.join(pluginRoot, 'dist'),
    libDir: path.join(pluginRoot, 'lib'),
    scriptsDir: path.join(pluginRoot, 'scripts'),
    bundleScript: path.join(pluginRoot, 'scripts/bundle.mjs'),
    selftestScript: path.join(pluginRoot, 'scripts/selftest.mjs'),
    installScript: path.join(pluginRoot, 'scripts/install.mjs')
  }
}

/** esbuild 工作目录：wikimap 宿主时回到 monorepo 根，独立 repo 用自身根 */
export function resolveEsbuildCwd (pluginRoot) {
  const wikimapRoot = path.join(pluginRoot, '../../../../')
  if (fs.existsSync(path.join(wikimapRoot, 'apps/web'))) return wikimapRoot
  return pluginRoot
}
