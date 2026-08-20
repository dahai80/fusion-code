/**
 * item 20: vimInsertModeRemaps 纯函数单测 (CC 2.1.208)
 */
import { describe, it, expect } from 'bun:test'
import {
    matchInsertRemap,
    getInsertRemapTimeoutMs,
} from '../hooks/useVimInput.js'

describe('matchInsertRemap', () => {
    it('空 remaps → 永远 passthrough (default off)', () => {
        const r = matchInsertRemap([], '', 'j')
        expect(r.action).toBe('passthrough')
        expect(r.newPrefix).toBe('')
    })

    it('jj 首键 j → prefix 暂存', () => {
        const r = matchInsertRemap(['jj'], '', 'j')
        expect(r.action).toBe('prefix')
        expect(r.newPrefix).toBe('j')
    })

    it('jj 次键 j → match', () => {
        const r = matchInsertRemap(['jj'], 'j', 'j')
        expect(r.action).toBe('match')
        expect(r.newPrefix).toBe('')
    })

    it('jj 首键 j 次键 k → passthrough (非前缀)', () => {
        const r = matchInsertRemap(['jj'], 'j', 'k')
        expect(r.action).toBe('passthrough')
        expect(r.newPrefix).toBe('')
    })

    it('jk remap → j prefix, k match', () => {
        expect(matchInsertRemap(['jk'], '', 'j').action).toBe('prefix')
        expect(matchInsertRemap(['jk'], 'j', 'k').action).toBe('match')
    })

    it('多 remap ["jj","jk"] → j 是两前缀, k 匹配 jk', () => {
        expect(matchInsertRemap(['jj', 'jk'], '', 'j').action).toBe('prefix')
        // j+j 匹配 jj
        expect(matchInsertRemap(['jj', 'jk'], 'j', 'j').action).toBe('match')
        // j+k 匹配 jk
        expect(matchInsertRemap(['jj', 'jk'], 'j', 'k').action).toBe('match')
    })

    it('空 input + 空 prefix → prefix (空串是任意序列前缀, 边缘但正确)', () => {
        // 生产中打印字符恒非空, 不会触达; 记录实际语义。
        expect(matchInsertRemap(['jj'], '', '').action).toBe('prefix')
        expect(matchInsertRemap(['jj'], '', '').newPrefix).toBe('')
    })

    it('三键序列 abc → a/b prefix, c match', () => {
        expect(matchInsertRemap(['abc'], '', 'a').action).toBe('prefix')
        expect(matchInsertRemap(['abc'], 'a', 'b').action).toBe('prefix')
        expect(matchInsertRemap(['abc'], 'ab', 'c').action).toBe('match')
    })
})

describe('getInsertRemapTimeoutMs', () => {
    const orig = process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS
    it('未设 → 默认 750', () => {
        delete process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS
        expect(getInsertRemapTimeoutMs()).toBe(750)
    })
    it('有效数字 → 用之', () => {
        process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS = '500'
        expect(getInsertRemapTimeoutMs()).toBe(500)
    })
    it('0 → 0 (禁超时, 合法 edge)', () => {
        process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS = '0'
        expect(getInsertRemapTimeoutMs()).toBe(0)
    })
    it('非数 → 默认 750 (fail-open)', () => {
        process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS = 'abc'
        expect(getInsertRemapTimeoutMs()).toBe(750)
    })
    it('负数 → 默认 750', () => {
        process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS = '-5'
        expect(getInsertRemapTimeoutMs()).toBe(750)
    })
    // 还原
    if (orig === undefined) {
        delete process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS
    } else {
        process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS = orig
    }
})
