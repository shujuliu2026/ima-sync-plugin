/**
 * selftest / stresstest 共用 · 快速模式与跳过 bundle
 *
 * --quick          缩小压力规模 + 跳过 selftest 内 esbuild bundle
 * --skip-build     仅跳过 bundle（须已有 dist/main.js）
 * IMA_SYNC_TEST_QUICK=1 · IMA_SYNC_SKIP_BUILD=1
 */

/** @param {string[]} [argv] */
export function parseTestFlags (argv = process.argv) {
  const quick = argv.includes('--quick') || process.env.IMA_SYNC_TEST_QUICK === '1'
  const skipBuild = quick ||
    argv.includes('--skip-build') ||
    process.env.IMA_SYNC_SKIP_BUILD === '1'
  return { quick, skipBuild }
}

/** @param {string[]} [argv] */
export function stressScale (argv = process.argv) {
  const { quick } = parseTestFlags(argv)
  if (quick) {
    return {
      noteCount: Math.max(100, Number(process.env.IMA_STRESS_NOTES) || 400),
      bodyKb: Math.max(16, Number(process.env.IMA_STRESS_BODY_KB) || 64),
      pushCount: Math.min(400, Math.max(30, Number(process.env.IMA_STRESS_PUSH) || 40))
    }
  }
  const noteCount = Math.max(100, Number(process.env.IMA_STRESS_NOTES) || 2000)
  return {
    noteCount,
    bodyKb: Math.max(16, Number(process.env.IMA_STRESS_BODY_KB) || 128),
    pushCount: Math.min(noteCount, Math.max(50, Number(process.env.IMA_STRESS_PUSH) || 120))
  }
}
