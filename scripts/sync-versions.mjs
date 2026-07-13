#!/usr/bin/env node
/**
 * 从 manifest.json + changelog 生成 Obsidian versions.json（社区/BRAT 自动更新）
 *
 * npm run sync-versions
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { getPaths } from './_paths.mjs'

const { pluginRoot } = getPaths()
const require = createRequire(import.meta.url)

const manifestPath = path.join(pluginRoot, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const minApp = manifest.minAppVersion || '1.4.0'

const { PLUGIN_VERSION, CHANGELOG } = require(path.join(pluginRoot, 'lib/changelog.js'))

/** @returns {Record<string, string>} */
function buildVersionsMap () {
  const versions = {}
  const add = (v) => {
    if (v && !versions[v]) versions[v] = minApp
  }
  add(manifest.version)
  add(PLUGIN_VERSION)
  for (const entry of CHANGELOG) add(entry.version)
  return versions
}

const versions = buildVersionsMap()
const outPath = path.join(pluginRoot, 'versions.json')
fs.writeFileSync(outPath, `${JSON.stringify(versions, null, 2)}\n`, 'utf8')

console.log(`[ima-sync:sync-versions] ${Object.keys(versions).length} entries → ${outPath}`)
console.log(`  latest v${manifest.version} · minApp ${minApp}`)
