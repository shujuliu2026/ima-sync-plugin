'use strict'

const MAX_FAILED_QUEUE = 500

/**
 * @typedef {{ path: string, error: string, at: string, attempts: number }} FailedEntry
 */

/**
 * @param {FailedEntry[]} queue
 * @param {string} notePath
 * @param {string} error
 * @returns {FailedEntry[]}
 */
function upsertFailedEntry (queue, notePath, error) {
  const path = String(notePath || '').trim()
  if (!path) return queue
  const now = new Date().toISOString()
  const idx = queue.findIndex(e => e.path === path)
  if (idx >= 0) {
    const prev = queue[idx]
    queue[idx] = {
      path,
      error: String(error || prev.error).slice(0, 500),
      at: now,
      attempts: (prev.attempts || 0) + 1
    }
    return queue
  }
  queue.unshift({ path, error: String(error || '').slice(0, 500), at: now, attempts: 1 })
  if (queue.length > MAX_FAILED_QUEUE) queue.length = MAX_FAILED_QUEUE
  return queue
}

/**
 * @param {FailedEntry[]} queue
 * @param {string} notePath
 * @returns {FailedEntry[]}
 */
function removeFailedEntry (queue, notePath) {
  return queue.filter(e => e.path !== notePath)
}

/**
 * @param {object} data
 * @returns {FailedEntry[]}
 */
function normalizeFailedQueue (data) {
  const raw = data?.failedQueue
  if (!Array.isArray(raw)) return []
  return raw
    .filter(e => e && e.path)
    .map(e => ({
      path: String(e.path),
      error: String(e.error || '').slice(0, 500),
      at: String(e.at || ''),
      attempts: Number(e.attempts) || 1
    }))
}

/**
 * @param {string} path
 */
function folderOfPath (path) {
  const p = String(path || '').replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i <= 0 ? '(root)' : p.slice(0, i)
}

/**
 * @param {Array<{ path: string }>} items
 * @returns {string[]}
 */
function uniqueFoldersFromPaths (items) {
  const set = new Set()
  for (const it of items || []) {
    if (it?.path) set.add(folderOfPath(it.path))
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * @param {Array<{ path: string }>} items
 * @param {string} folder '' | '(root)' | path prefix
 */
function filterItemsByFolder (items, folder) {
  const f = String(folder || '')
  if (!f) return items || []
  return (items || []).filter((it) => folderOfPath(it.path) === f)
}

module.exports = {
  MAX_FAILED_QUEUE,
  upsertFailedEntry,
  removeFailedEntry,
  normalizeFailedQueue,
  folderOfPath,
  uniqueFoldersFromPaths,
  filterItemsByFolder
}
