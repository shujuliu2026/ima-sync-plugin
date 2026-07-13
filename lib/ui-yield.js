'use strict'

/** 让浏览器/Obsidian 先绘制一帧，避免长时间 await 前界面无反馈 */
function yieldToUi () {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0))
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
