/**
 * Project-level API server — exposes project context, sessions, memory
 * via HTTP for Fusion Studio integration.
 *
 * Uses Bun.serve() for zero-dependency HTTP.
 * All endpoints accept `cwd` query param to resolve project paths.
 */

import { mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { getProjectContextPortable } from '../utils/claudemdPortable.js'
import { scanMemoryFiles } from '../memdir/memoryScan.js'
import { logForDebugging } from '../utils/debug.js'
import {
    getProjectsDir,
    sanitizePath,
    validateUuid,
    readSessionLite,
} from '../utils/sessionStoragePortable.js'
import { listSessionsImpl } from '../utils/listSessionsImpl.js'
import type { ServerConfig } from './types.js'

type RouteHandler = (
    url: URL,
    body: Record<string, unknown> | null,
    pathParams?: Map<string, string>,
) => Promise<Response>

const routes = new Map<string, RouteHandler>()

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

function errorResponse(message: string, status = 400): Response {
    return jsonResponse({ error: message }, status)
}

function getCwdFromUrl(url: URL): string {
    return url.searchParams.get('cwd') ?? process.cwd()
}

// GET /api/project/context
routes.set('/api/project/context', async url => {
    const cwd = getCwdFromUrl(url)
    try {
        const context = await getProjectContextPortable(cwd)
        return jsonResponse(context)
    } catch (e) {
        logForDebugging(`projectApiServer: /api/project/context error: ${e}`)
        return errorResponse('Failed to load project context', 500)
    }
})

// GET /api/sessions
routes.set('/api/sessions', async url => {
    const cwd = getCwdFromUrl(url)
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
    try {
        const sessions = await listSessionsImpl({
            dir: cwd,
            limit: Math.min(limit, 200),
            offset,
        })
        return jsonResponse({ sessions, total: sessions.length })
    } catch (e) {
        logForDebugging(`projectApiServer: /api/sessions error: ${e}`)
        return errorResponse('Failed to list sessions', 500)
    }
})

// GET /api/sessions/:id
routes.set('/api/sessions/:id', async (url, _body, pathParams) => {
    const sessionId = pathParams?.get('id')
    if (!sessionId || !validateUuid(sessionId)) {
        return errorResponse('Invalid session ID', 400)
    }
    const cwd = getCwdFromUrl(url)
    try {
        const projectsDir = getProjectsDir()
        const projectDir = join(projectsDir, sanitizePath(cwd))
        const lite = await readSessionLite(projectDir, sessionId)
        if (!lite) {
            return errorResponse('Session not found', 404)
        }
        return jsonResponse(lite)
    } catch (e) {
        logForDebugging(`projectApiServer: /api/sessions/:id error: ${e}`)
        return errorResponse('Failed to read session', 500)
    }
})

// GET /api/memory
routes.set('/api/memory', async url => {
    const cwd = getCwdFromUrl(url)
    const configHome =
        process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), '.fusion-code')
    const memoryDir = join(
        configHome,
        'projects',
        sanitizePath(cwd),
        'memory',
    )
    try {
        const controller = new AbortController()
        const memories = await scanMemoryFiles(memoryDir, controller.signal)
        return jsonResponse({ memories, cwd })
    } catch (e) {
        logForDebugging(`projectApiServer: /api/memory GET error: ${e}`)
        return errorResponse('Failed to scan memory', 500)
    }
})

// POST /api/memory
routes.set('POST /api/memory', async (url, body) => {
    if (!body || typeof body !== 'object') {
        return errorResponse('Request body required', 400)
    }
    const { filename, content, type } = body as Record<string, string>
    if (!filename || !content) {
        return errorResponse('filename and content are required', 400)
    }
    if (filename.includes('..') || filename.includes('/')) {
        return errorResponse('filename must not contain .. or /', 400)
    }
    const cwd = getCwdFromUrl(url)
    const configHome =
        process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), '.fusion-code')
    const memoryDir = join(
        configHome,
        'projects',
        sanitizePath(cwd),
        'memory',
    )
    const filePath = join(memoryDir, filename)
    try {
        await mkdir(dirname(filePath), { recursive: true })
        const frontmatter = `---\nname: ${filename.replace('.md', '')}\ndescription: Auto-saved via API\ntype: ${type || 'project'}\n---\n\n`
        await writeFile(filePath, frontmatter + content, 'utf-8')
        return jsonResponse({ ok: true, path: filePath })
    } catch (e) {
        logForDebugging(`projectApiServer: /api/memory POST error: ${e}`)
        return errorResponse('Failed to write memory file', 500)
    }
})

function matchRoute(
    pathname: string,
    method: string,
): { handler: RouteHandler; pathParams: Map<string, string> } | null {
    // Try exact match first (with method prefix for POST)
    const methodKey = method === 'POST' ? `POST ${pathname}` : pathname
    const exact = routes.get(methodKey)
    if (exact) return { handler: exact, pathParams: new Map() }

    // Try parameterized match (e.g., /api/sessions/:id)
    for (const [pattern, handler] of routes) {
        const cleanPattern = pattern.startsWith('POST ')
            ? pattern.slice(5)
            : pattern
        const patternParts = cleanPattern.split('/')
        const pathParts = pathname.split('/')
        if (patternParts.length !== pathParts.length) continue

        const params = new Map<string, string>()
        let match = true
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                params.set(patternParts[i].slice(1), pathParts[i])
            } else if (patternParts[i] !== pathParts[i]) {
                match = false
                break
            }
        }
        if (match) return { handler, pathParams: params }
    }
    return null
}

export function startProjectApiServer(config: ServerConfig): {
    port: number
    stop: () => void
} {
    const server = Bun.serve({
        port: config.port,
        hostname: config.host || '127.0.0.1',
        async fetch(req) {
            const url = new URL(req.url)
            const method = req.method

            // CORS headers for Fusion Studio
            if (method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers':
                            'Content-Type, Authorization',
                    },
                })
            }

            // Auth check
            if (config.authToken) {
                const auth = req.headers.get('Authorization')
                if (auth !== `Bearer ${config.authToken}`) {
                    return errorResponse('Unauthorized', 401)
                }
            }

            const matched = matchRoute(url.pathname, method)
            if (!matched) {
                return errorResponse('Not found', 404)
            }

            let body: Record<string, unknown> | null = null
            if (method === 'POST') {
                try {
                    body = (await req.json()) as Record<string, unknown>
                } catch {
                    return errorResponse('Invalid JSON body', 400)
                }
            }

            try {
                const response = await matched.handler(
                    url,
                    body,
                    matched.pathParams,
                )
                // Add CORS headers to all responses
                response.headers.set('Access-Control-Allow-Origin', '*')
                return response
            } catch (e) {
                logForDebugging(`projectApiServer: unhandled error: ${e}`)
                return errorResponse('Internal server error', 500)
            }
        },
    })

    logForDebugging(
        `projectApiServer: listening on ${config.host || '127.0.0.1'}:${server.port}`,
    )

    return {
        port: server.port,
        stop: () => server.stop(),
    }
}
