/**
 * Hook 测试
 */
import { describe, it, expect } from 'bun:test'

describe('useKeybinding', () => {
  it('should export useKeybinding hook', async () => {
    const mod = await import('../../src/keybindings/useKeybinding.js')
    expect(mod.useKeybinding).toBeDefined()
  })
})

describe('Keybinding utilities', () => {
  it('should export DEFAULT_BINDINGS', async () => {
    const mod = await import('../../src/keybindings/defaultBindings.js')
    expect(mod.DEFAULT_BINDINGS).toBeDefined()
    expect(Array.isArray(mod.DEFAULT_BINDINGS)).toBe(true)
  })
  it('should export loadKeybindings', async () => {
    const mod = await import('../../src/keybindings/loadUserBindings.js')
    expect(mod.loadKeybindings).toBeDefined()
  })
  it('should export matchesBinding', async () => {
    const mod = await import('../../src/keybindings/match.js')
    expect(mod.matchesBinding).toBeDefined()
  })
  it('should export parseBindings', async () => {
    const mod = await import('../../src/keybindings/parser.js')
    expect(mod.parseBindings).toBeDefined()
  })
  it('should export resolveKey', async () => {
    const mod = await import('../../src/keybindings/resolver.js')
    expect(mod.resolveKey).toBeDefined()
  })
  it('should export validateBindings', async () => {
    const mod = await import('../../src/keybindings/validate.js')
    expect(mod.validateBindings).toBeDefined()
  })
})

describe('useTerminalSize', () => {
  it('should export useTerminalSize hook', async () => {
    const mod = await import('../../src/hooks/useTerminalSize.js')
    expect(mod.useTerminalSize).toBeDefined()
  })
})

describe('useSettings', () => {
  it('should export useSettings hook', async () => {
    const mod = await import('../../src/hooks/useSettings.js')
    expect(mod.useSettings).toBeDefined()
  })
})

describe('useVoice', () => {
  it('should export useVoice hook', async () => {
    const mod = await import('../../src/hooks/useVoice.js')
    expect(mod.useVoice).toBeDefined()
  })
})

describe('useApiKeyVerification', () => {
  it('should export useApiKeyVerification hook', async () => {
    const mod = await import('../../src/hooks/useApiKeyVerification.js')
    expect(mod.useApiKeyVerification).toBeDefined()
  })
})

describe('useCommandQueue', () => {
  it('should export useCommandQueue hook', async () => {
    const mod = await import('../../src/hooks/useCommandQueue.js')
    expect(mod.useCommandQueue).toBeDefined()
  })
})

describe('useHistorySearch', () => {
  it('should export useHistorySearch hook', async () => {
    const mod = await import('../../src/hooks/useHistorySearch.js')
    expect(mod.useHistorySearch).toBeDefined()
  })
})

describe('useMemoryUsage', () => {
  it('should export useMemoryUsage hook', async () => {
    const mod = await import('../../src/hooks/useMemoryUsage.js')
    expect(mod.useMemoryUsage).toBeDefined()
  })
})

describe('useTimeout', () => {
  it('should export useTimeout hook', async () => {
    const mod = await import('../../src/hooks/useTimeout.js')
    expect(mod.useTimeout).toBeDefined()
  })
})

describe('useElapsedTime', () => {
  it('should export useElapsedTime hook', async () => {
    const mod = await import('../../src/hooks/useElapsedTime.js')
    expect(mod.useElapsedTime).toBeDefined()
  })
})

describe('useBlink', () => {
  it('should export useBlink hook', async () => {
    const mod = await import('../../src/hooks/useBlink.js')
    expect(mod.useBlink).toBeDefined()
  })
})

describe('useDoublePress', () => {
  it('should export useDoublePress hook', async () => {
    const mod = await import('../../src/hooks/useDoublePress.js')
    expect(mod.useDoublePress).toBeDefined()
  })
})

describe('useTextInput', () => {
  it('should export useTextInput hook', async () => {
    const mod = await import('../../src/hooks/useTextInput.js')
    expect(mod.useTextInput).toBeDefined()
  })
})

describe('usePromptSuggestion', () => {
  it('should export usePromptSuggestion hook', async () => {
    const mod = await import('../../src/hooks/usePromptSuggestion.js')
    expect(mod.usePromptSuggestion).toBeDefined()
  })
})

describe('useSearchInput', () => {
  it('should export useSearchInput hook', async () => {
    const mod = await import('../../src/hooks/useSearchInput.js')
    expect(mod.useSearchInput).toBeDefined()
  })
})

describe('useExitOnCtrlCD', () => {
  it('should export useExitOnCtrlCD hook', async () => {
    const mod = await import('../../src/hooks/useExitOnCtrlCD.js')
    expect(mod.useExitOnCtrlCD).toBeDefined()
  })
})

describe('useAfterFirstRender', () => {
  it('should export useAfterFirstRender hook', async () => {
    const mod = await import('../../src/hooks/useAfterFirstRender.js')
    expect(mod.useAfterFirstRender).toBeDefined()
  })
})

describe('useAwaySummary', () => {
  it('should export useAwaySummary hook', async () => {
    const mod = await import('../../src/hooks/useAwaySummary.js')
    expect(mod.useAwaySummary).toBeDefined()
  })
})

describe('useInputBuffer', () => {
  it('should export useInputBuffer hook', async () => {
    const mod = await import('../../src/hooks/useInputBuffer.js')
    expect(mod.useInputBuffer).toBeDefined()
  })
})

describe('useVimInput', () => {
  it('should export useVimInput hook', async () => {
    const mod = await import('../../src/hooks/useVimInput.js')
    expect(mod.useVimInput).toBeDefined()
  })
})