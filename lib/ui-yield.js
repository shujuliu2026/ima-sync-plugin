'use strict'

/** 让浏览器/Obsidian 先绘制一帧，避免长时间 await 前界面无反馈 */
function yieldToUi () {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      // 双 rAF：等布局+绘制完成再继续重活；比 rAF+setTimeout 更稳、体感更跟手
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve)
      })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** @param {Promise<T>} promise @param {number} ms @param {string} label */
async function withTimeout (promise, ms, label) {
  let timer = 0
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(`${label || 'IMA_TIMEOUT'}: ${ms}ms`))
        }, ms)
      })
    ])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

module.exports = { yieldToUi, withTimeout }
