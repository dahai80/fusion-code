export async function logHandler(logId: string | number | undefined): Promise<void> {
    console.log(`logHandler: ${logId}`)
}

export async function errorHandler(_number?: number | undefined): Promise<void> {
    console.log('errorHandler')
}

export async function exportHandler(_source?: string, _outputFile?: string): Promise<void> {
    console.log('exportHandler')
}

export async function taskCreateHandler(
    subject: string | undefined,
    opts: { description?: string; list?: string },
): Promise<void> {
    console.log(`taskCreateHandler: ${subject}`, opts)
}

export async function taskListHandler(_opts?: { list?: string; pending?: boolean; json?: boolean }): Promise<void> {
    console.log('taskListHandler')
}

export async function taskGetHandler(id: string, _opts?: { list?: string }): Promise<void> {
    console.log(`taskGetHandler: ${id}`)
}

export async function taskUpdateHandler(
    id: string,
    opts: Record<string, unknown>,
): Promise<void> {
    console.log(`taskUpdateHandler: ${id}`, opts)
}

export async function taskDirHandler(_opts?: { list?: string }): Promise<void> {
    console.log('taskDirHandler')
}

export async function completionHandler(_shell?: string, _opts?: { output?: string }, _program?: unknown): Promise<void> {
    console.log('completionHandler')
}
