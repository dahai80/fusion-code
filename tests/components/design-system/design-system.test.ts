/**
 * 设计系统组件测试
 * 注意：React/Ink 组件在测试环境中可能无法完整初始化，
 * 因此测试聚焦于模块可加载性验证。
 */
import { describe, it, expect } from 'bun:test'

describe('Design system modules', () => {
  it('should load Dialog module', async () => {
    const mod = await import('../../../src/components/design-system/Dialog.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load Pane module', async () => {
    const mod = await import('../../../src/components/design-system/Pane.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load ProgressBar module', async () => {
    const mod = await import('../../../src/components/design-system/ProgressBar.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load Tabs module', async () => {
    const mod = await import('../../../src/components/design-system/Tabs.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load KeyboardShortcutHint module', async () => {
    const mod = await import('../../../src/components/design-system/KeyboardShortcutHint.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load StatusIcon module', async () => {
    const mod = await import('../../../src/components/design-system/StatusIcon.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load Byline module', async () => {
    const mod = await import('../../../src/components/design-system/Byline.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load Divider module', async () => {
    const mod = await import('../../../src/components/design-system/Divider.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load FuzzyPicker module', async () => {
    const mod = await import('../../../src/components/design-system/FuzzyPicker.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load LoadingState module', async () => {
    const mod = await import('../../../src/components/design-system/LoadingState.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load ListItem module', async () => {
    const mod = await import('../../../src/components/design-system/ListItem.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
  it('should load Ratchet module', async () => {
    const mod = await import('../../../src/components/design-system/Ratchet.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})