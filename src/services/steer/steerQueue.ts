import { logForDebugging } from '../../utils/debug.js'

export type SteerContent = string

export class SteerQueue {
    private queue: SteerContent[] = []
    private maxQueueSize = 10

    enqueue(content: SteerContent): void {
        if (this.queue.length >= this.maxQueueSize) {
            logForDebugging(`steer-queue-overflow dropped=${content.slice(0, 100)}`) // log: inline data into message string
            return
        }
        this.queue.push(content)
        logForDebugging(`steer-enqueued queueSize=${this.queue.length}`) // log: inline data into message string
    }

    drain(): SteerContent[] {
        const items = [...this.queue]
        this.queue = []
        if (items.length > 0) {
            logForDebugging(`steer-drained count=${items.length}`) // log: inline data into message string
        }
        return items
    }

    peek(): SteerContent | undefined {
        return this.queue[0]
    }

    hasPending(): boolean {
        return this.queue.length > 0
    }

    size(): number {
        return this.queue.length
    }

    clear(): void {
        this.queue = []
    }
}

let _instance: SteerQueue | null = null

export function getSteerQueue(): SteerQueue {
    if (!_instance) {
        _instance = new SteerQueue()
    }
    return _instance
}
