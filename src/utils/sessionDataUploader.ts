// Stub for internal-only session data uploader.
// Real implementation only exists in the internal repo.

export function createSessionTurnUploader(): null {
    return null
}

export function uploadSessionData(_data: unknown): Promise<void> {
    return Promise.resolve()
}
