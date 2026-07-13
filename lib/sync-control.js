'use strict'

/** 同步任务 · 暂停 / 停止控制 */
class SyncControl {
  constructor () {
    this.stopRequested = false
    this.paused = false
  }

  reset () {
    this.stopRequested = false
    this.paused = false
  }

  requestStop () {
    this.stopRequested = true
    this.paused = false
  }

  pause () {
    this.paused = true
  }

  resume () {
    this.paused = false
  }

  /** @returns {Promise<boolean>} false = 应停止 */
  async gate () {
    while (this.paused && !this.stopRequested) {
      await new Promise(r => setTimeout(r, 150))
    }
    return !this.stopRequested
  }
}

module.exports = { SyncControl }
