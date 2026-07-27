import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { join, dirname } from 'path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getSessionId } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import type { SessionBookmark } from '../../types/sessionBookmark.js'

const BOOKMARKS_FILE = 'session-bookmarks.json'

async function getBookmarksPath(): Promise<string> {
    const configDir = getClaudeConfigHomeDir()
    return join(configDir, BOOKMARKS_FILE)
}

async function loadBookmarks(): Promise<SessionBookmark[]> {
    const path = await getBookmarksPath()
    try {
        const data = await readFile(path, 'utf-8')
        return JSON.parse(data)
    } catch {
        return []
    }
}

async function saveBookmarks(bookmarks: SessionBookmark[]): Promise<void> {
    const path = await getBookmarksPath()
    await mkdir(dirname(path), { recursive: true })
    const tmpPath = `${path}.tmp`
    await writeFile(tmpPath, JSON.stringify(bookmarks, null, 2), 'utf-8')
    await rename(tmpPath, path)
    logForDebugging(`[save-session] bookmarks saved atomically to ${path}`)
}

export const call: LocalCommandCall = async (args, context) => {
    const name = args.trim()
    if (!name) {
        return {
            display: 'Usage: /save-session <name>\n\nGive the current session a name so you can resume it later with /resume-session <name>.',
        } satisfies LocalCommandResult
    }

    const sessionId = getSessionId()
    const projectPath = context.cwd || process.cwd()

    const bookmarks = await loadBookmarks()

    const existing = bookmarks.findIndex(b => b.name === name)
    const bookmark: SessionBookmark = {
        name,
        sessionId,
        projectPath,
        description: `Session ${name}`,
        savedAt: new Date().toISOString(),
    }

    if (existing >= 0) {
        bookmarks[existing] = bookmark
    } else {
        bookmarks.push(bookmark)
    }

    await saveBookmarks(bookmarks)

    console.log(`[save-session] saved "${name}" → session ${sessionId}`)

    return {
        display: `Session saved as "${name}". Resume with /resume-session ${name}`,
    } satisfies LocalCommandResult
}
