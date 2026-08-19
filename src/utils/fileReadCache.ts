import { detectFileEncoding } from './file.js'
import { getFsImplementation } from './fsOperations.js'

type CachedFileData = {
  content: string
  encoding: BufferEncoding
  mtime: number
}

/**
 * A simple in-memory cache for file contents with automatic invalidation based on modification time.
 * This eliminates redundant file reads in FileEditTool operations.
 */
class FileReadCache {
  private cache = new Map<string, CachedFileData>()
  private readonly maxCacheSize = 1000
  // 对齐 CC 2.1.208 (issue #75): 字节上限, 防 1000 大文件无界占内存 (如 1000×10MB≈10GB)
  private readonly maxCacheBytes = 16 * 1024 * 1024
  private currentBytes = 0

  /**
   * Reads a file with caching. Returns both content and encoding.
   * Cache key includes file path and modification time for automatic invalidation.
   */
  readFile(filePath: string): { content: string; encoding: BufferEncoding } {
    const fs = getFsImplementation()

    // Get file stats for cache invalidation
    let stats
    try {
      stats = fs.statSync(filePath)
    } catch (error) {
      // File was deleted, remove from cache and re-throw
      this.cache.delete(filePath)
      throw error
    }

    const cacheKey = filePath
    const cachedData = this.cache.get(cacheKey)

    // Check if we have valid cached data
    if (cachedData && cachedData.mtime === stats.mtimeMs) {
      return {
        content: cachedData.content,
        encoding: cachedData.encoding,
      }
    }

    // Cache miss or stale data - read the file
    const encoding = detectFileEncoding(filePath)
    const content = fs
      .readFileSync(filePath, { encoding })
      .replaceAll('\r\n', '\n')

    // 覆盖旧条目时先扣旧字节 (避免重复计)
    const oldEntry = this.cache.get(cacheKey)
    if (oldEntry) {
      this.currentBytes -= Buffer.byteLength(oldEntry.content)
    }
    const entryBytes = Buffer.byteLength(content)

    // Update cache
    this.cache.set(cacheKey, {
      content,
      encoding,
      mtime: stats.mtimeMs,
    })
    this.currentBytes += entryBytes

    // Evict 10% of oldest entries when cache exceeds max size OR max bytes
    // (对齐 CC 2.1.208: entry-count + byte 双 cap, issue #75)
    // This amortizes eviction cost instead of evicting one entry per insert
    if (
      this.cache.size > this.maxCacheSize ||
      this.currentBytes > this.maxCacheBytes
    ) {
      const evictCount = Math.max(1, Math.floor(this.maxCacheSize * 0.1))
      let evicted = 0
      for (const key of this.cache.keys()) {
        if (evicted >= evictCount) break
        const evictedEntry = this.cache.get(key)
        if (evictedEntry) {
          this.currentBytes -= Buffer.byteLength(evictedEntry.content)
        }
        this.cache.delete(key)
        evicted++
      }
    }

    return { content, encoding }
  }

  /**
   * Clears the entire cache. Useful for testing or memory management.
   */
  clear(): void {
    this.cache.clear()
    this.currentBytes = 0
  }

  /**
   * Removes a specific file from the cache.
   */
  invalidate(filePath: string): void {
    const entry = this.cache.get(filePath)
    if (entry) {
      this.currentBytes -= Buffer.byteLength(entry.content)
    }
    this.cache.delete(filePath)
  }

  /**
   * Gets cache statistics for debugging/monitoring.
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }
}

// Export a singleton instance
export const fileReadCache = new FileReadCache()
