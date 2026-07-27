export async function logHandler(logId: string | number | undefined): Promise<void> {
    console.log(`logHandler: ${logId}`)
}

export async function errorHandler(): Promise<void> {
    console.log('errorHandler')
}

export async function exportHandler(): Promise<void> {
    console.log('exportHandler')
}

export async function taskCreateHandler(
    subject: string | undefined,
    opts: { description?: string; list?: string },
): Promise<void> {
    console.log(`taskCreateHandler: ${subject}`, opts)
}

export async function taskListHandler(): Promise<void> {
    console.log('taskListHandler')
}

export async function taskGetHandler(id: string): Promise<void> {
    console.log(`taskGetHandler: ${id}`)
}

export async function taskUpdateHandler(
    id: string,
    opts: Record<string, unknown>,
): Promise<void> {
    console.log(`taskUpdateHandler: ${id}`, opts)
}

export async function taskDirHandler(): Promise<void> {
    console.log('taskDirHandler')
}

export async function completionHandler(): Promise<void> {
    console.log('completionHandler')
}
