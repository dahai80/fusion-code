/**
 * 强制设置 FORCE_COLOR=1，确保 chalk 库在终端中正确初始化。
 * 必须在任何 chalk 导入之前被引入。
 */
Object.defineProperty(process.env, 'FORCE_COLOR', {
  value: '1',
  configurable: true,
  writable: true,
})