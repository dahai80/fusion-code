// log: created for TS2307 fix

export type SecureStorageData = Record<string, unknown>

export interface SecureStorage {
    read(): SecureStorageData | null
    readAsync(): Promise<SecureStorageData | null>
    update(data: SecureStorageData): { success: boolean; warning?: string }
    updateAsync(data: SecureStorageData): Promise<{ success: boolean; warning?: string }>
}
