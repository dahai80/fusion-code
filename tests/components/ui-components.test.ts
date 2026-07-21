/**
 * 关键 UI 组件测试
 */
import { describe, it, expect } from 'bun:test'

describe('Markdown', () => {
  it('should export Markdown component', async () => {
    const mod = await import('../../src/components/Markdown.js')
    expect(mod.Markdown).toBeDefined()
  })
})

describe('MarkdownTable', () => {
  it('should export MarkdownTable component', async () => {
    const mod = await import('../../src/components/MarkdownTable.js')
    expect(mod.MarkdownTable).toBeDefined()
  })
})

describe('HighlightedCode', () => {
  it('should export HighlightedCode component', async () => {
    const mod = await import('../../src/components/HighlightedCode.js')
    expect(mod.HighlightedCode).toBeDefined()
  })
})

describe('Spinner', () => {
  it('should export FlashingChar component', async () => {
    const mod = await import('../../src/components/Spinner/index.js')
    expect(mod.FlashingChar).toBeDefined()
  })
})

describe('SpinnerAnimationRow', () => {
  it('should export SpinnerAnimationRow', async () => {
    const mod = await import('../../src/components/Spinner/SpinnerAnimationRow.js')
    expect(mod.SpinnerAnimationRow).toBeDefined()
  })
})

describe('Message', () => {
  it('should export Message component', async () => {
    const mod = await import('../../src/components/Message.js')
    expect(mod.Message).toBeDefined()
  })
})

describe('Messages', () => {
  it('should export Messages component', async () => {
    const mod = await import('../../src/components/Messages.js')
    expect(mod.Messages).toBeDefined()
  })
})

describe('FullscreenLayout', () => {
  it('should export FullscreenLayout component', async () => {
    const mod = await import('../../src/components/FullscreenLayout.js')
    expect(mod.FullscreenLayout).toBeDefined()
  })
})

describe('StatusLine', () => {
  it('should export StatusLine component', async () => {
    const mod = await import('../../src/components/StatusLine.js')
    expect(mod.StatusLine).toBeDefined()
  })
})

describe('ContextVisualization', () => {
  it('should export ContextVisualization component', async () => {
    const mod = await import('../../src/components/ContextVisualization.js')
    expect(mod.ContextVisualization).toBeDefined()
  })
})