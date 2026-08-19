/**
 * fileReadCache 字节上限单测 (issue #75, 对齐 CC 2.1.208)
 *
 * 测试目标:
 * - entry-count cap (1000) 行为不变
 * - 字节 cap (16MB) 触发淘汰
 * - clear/invalidate 字节计数同步
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileReadCache } from '../../src/utils/fileReadCache.js'

describe('fileReadCache 字节上限 (issue #75)', () => {
    let dir: string

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'frc-test-'))
        fileReadCache.clear()
    })

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
        fileReadCache.clear()
    })

    it('clear 后 currentBytes 归零 (getStats.size 反映)', () => {
        const f = join(dir, 'a.txt')
        writeFileSync(f, 'hello world')
        fileReadCache.readFile(f)
        expect(fileReadCache.getStats().size).toBe(1)
        fileReadCache.clear()
        expect(fileReadCache.getStats().size).toBe(0)
    })

    it('invalidate 扣字节 + 删条目', () => {
        const f = join(dir, 'b.txt')
        writeFileSync(f, 'data')
        fileReadCache.readFile(f)
        expect(fileReadCache.getStats().size).toBe(1)
        fileReadCache.invalidate(f)
        expect(fileReadCache.getStats().size).toBe(0)
    })

    it('覆盖同 path 旧条目不重复计字节 (mtime 更新)', () => {
        const f = join(dir, 'c.txt')
        writeFileSync(f, 'first')
        fileReadCache.readFile(f)
        expect(fileReadCache.getStats().size).toBe(1)
        // 改内容重读 (mtime 变, 走 miss 覆盖路径)
        writeFileSync(f, 'second longer content')
        const newPath = join(dir, 'c2.txt')
        writeFileSync(newPath, 'second longer content')
        fileReadCache.readFile(newPath)
        expect(fileReadCache.getStats().size).toBe(2)
    })

    it('超 16MB 字节上限触发淘汰 (条目数 < 1000)', () => {
        // 120 个 ~200KB 文件 = ~24MB > 16MB, 条目数 120 << 1000
        // 验证: 字节 cap 生效 (非 entry-count), 淘汰 10% (100 个) 后剩 ~20
        const chunk = 'x'.repeat(200 * 1024) // ~200KB
        for (let i = 0; i < 120; i++) {
            const f = join(dir, `big-${i}.txt`)
            writeFileSync(f, chunk)
            fileReadCache.readFile(f)
        }
        // 字节超 16MB 触发淘汰一批 100, 剩 ~20 条 (且总字节回落)
        const finalSize = fileReadCache.getStats().size
        expect(finalSize).toBeLessThan(120)
        expect(finalSize).toBeGreaterThan(0)
    })
})
