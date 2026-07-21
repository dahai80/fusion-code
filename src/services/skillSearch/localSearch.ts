/**
 * Local Skill Search — 本地技能搜索
 *
 * 提供本地技能索引和搜索功能。
 * 支持从本地文件系统搜索和发现可用技能。
 *
 * gated by feature('EXPERIMENTAL_SKILL_SEARCH')
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'

export interface SkillIndex {
  name: string
  slug: string
  description: string
  filePath: string
  lastModified: number
  source: 'local' | 'bundled' | 'remote'
}

let cachedIndex: SkillIndex[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000 // 1 minute

const SKILL_DIRS = ['skills', 'bundled-skills']

/**
 * Get the list of skill directories to search.
 */
function getSkillDirectories(): string[] {
  const configDir = getClaudeConfigHomeDir()
  return SKILL_DIRS.map(dir => join(configDir, dir)).filter(d => existsSync(d))
}

/**
 * Search for skills matching a query.
 */
export function searchSkills(query: string): SkillIndex[] {
  const index = getSkillIndex()
  if (!query) return index

  const lowerQuery = query.toLowerCase()
  return index.filter(
    skill =>
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.description.toLowerCase().includes(lowerQuery) ||
      skill.slug.toLowerCase().includes(lowerQuery),
  )
}

/**
 * Get or build the skill index.
 */
export function getSkillIndex(): SkillIndex[] {
  const now = Date.now()
  if (cachedIndex && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedIndex
  }

  cachedIndex = buildSkillIndex()
  cacheTimestamp = now
  return cachedIndex
}

/**
 * Build the skill index by scanning skill directories.
 */
function buildSkillIndex(): SkillIndex[] {
  const index: SkillIndex[] = []
  const dirs = getSkillDirectories()

  for (const dir of dirs) {
    try {
      const files = readdirSync(dir)
      for (const file of files) {
        if (extname(file) !== '.md') continue

        const filePath = join(dir, file)
        try {
          const content = readFileSync(filePath, 'utf-8')
          const stats = statSync(filePath)
          const slug = file.replace(/\.md$/, '')

          // Parse frontmatter for name/description
          const name = extractFrontMatterField(content, 'name') || slug
          const description = extractFrontMatterField(content, 'description') || ''

          index.push({
            name,
            slug,
            description,
            filePath,
            lastModified: stats.mtimeMs,
            source: 'local',
          })
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return index
}

/**
 * Extract a field from markdown frontmatter.
 */
function extractFrontMatterField(content: string, field: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const frontmatter = match[1]!
  const lineRegex = new RegExp(`^${field}:(.+)$`, 'm')
  const fieldMatch = frontmatter.match(lineRegex)
  return fieldMatch ? fieldMatch[1]!.trim() : null
}

/**
 * Clear the skill index cache.
 */
export function clearSkillIndexCache(): void {
  cachedIndex = null
  cacheTimestamp = 0
  logForDebugging('[SkillSearch] Skill index cache cleared')
}

/**
 * Check if skill search is enabled.
 */
export function isSkillSearchEnabled(): boolean {
  return true
}