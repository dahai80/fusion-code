import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'
import type { StreamClientEvent } from './SSETransport.js'

export interface Transport {
    connect(): Promise<void>
    write(message: StdoutMessage): Promise<void>
    setOnData(callback: (data: string) => void): void
    setOnClose(callback: (closeCode?: number) => void): void
    setOnEvent?(callback: (event: StreamClientEvent) => void): void
    setOnConnect?(callback: () => void): void
}
