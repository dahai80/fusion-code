/**
 * PromptInput 组件测试
 */
import { describe, it, expect } from 'bun:test'

describe('PromptInput', () => {
  it('should load PromptInput module', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInput.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})

describe('PromptInputFooter', () => {
  it('should load PromptInputFooter module', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInputFooter.js')
    expect(mod).toBeDefined()
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})

describe('PromptInputFooterLeftSide', () => {
  it('should export PromptInputFooterLeftSide component', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInputFooterLeftSide.js')
    expect(mod.PromptInputFooterLeftSide).toBeDefined()
  })
})

describe('PromptInputFooterSuggestions', () => {
  it('should export PromptInputFooterSuggestions component', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInputFooterSuggestions.js')
    expect(mod.PromptInputFooterSuggestions).toBeDefined()
  })
})

describe('PromptInputHelpMenu', () => {
  it('should export PromptInputHelpMenu component', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInputHelpMenu.js')
    expect(mod.PromptInputHelpMenu).toBeDefined()
  })
})

describe('PromptInputModeIndicator', () => {
  it('should export PromptInputModeIndicator component', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInputModeIndicator.js')
    expect(mod.PromptInputModeIndicator).toBeDefined()
  })
})

describe('VoiceIndicator', () => {
  it('should export VoiceIndicator component', async () => {
    const mod = await import('../../../src/components/PromptInput/VoiceIndicator.js')
    expect(mod.VoiceIndicator).toBeDefined()
  })
})

describe('Notifications', () => {
  it('should export Notifications component', async () => {
    const mod = await import('../../../src/components/PromptInput/Notifications.js')
    expect(mod.Notifications).toBeDefined()
  })
})

describe('IssueFlagBanner', () => {
  it('should export IssueFlagBanner component', async () => {
    const mod = await import('../../../src/components/PromptInput/IssueFlagBanner.js')
    expect(mod.IssueFlagBanner).toBeDefined()
  })
})

describe('PromptInputStashNotice', () => {
  it('should export PromptInputStashNotice component', async () => {
    const mod = await import('../../../src/components/PromptInput/PromptInputStashNotice.js')
    expect(mod.PromptInputStashNotice).toBeDefined()
  })
})

describe('SandboxPromptFooterHint', () => {
  it('should export SandboxPromptFooterHint component', async () => {
    const mod = await import('../../../src/components/PromptInput/SandboxPromptFooterHint.js')
    expect(mod.SandboxPromptFooterHint).toBeDefined()
  })
})

describe('PromptInput utilities', () => {
  it('should export usePromptInputPlaceholder', async () => {
    const mod = await import('../../../src/components/PromptInput/usePromptInputPlaceholder.js')
    expect(mod.usePromptInputPlaceholder).toBeDefined()
  })
  it('should export useShowFastIconHint', async () => {
    const mod = await import('../../../src/components/PromptInput/useShowFastIconHint.js')
    expect(mod.useShowFastIconHint).toBeDefined()
  })
  it('should export useSwarmBanner', async () => {
    const mod = await import('../../../src/components/PromptInput/useSwarmBanner.js')
    expect(mod.useSwarmBanner).toBeDefined()
  })
  it('should export useMaybeTruncateInput', async () => {
    const mod = await import('../../../src/components/PromptInput/useMaybeTruncateInput.js')
    expect(mod.useMaybeTruncateInput).toBeDefined()
  })
})