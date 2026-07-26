import { EventEmitter } from 'events'
import { logForDebugging } from '../../utils/debug.js'

export type EventSeverity = 'critical' | 'info' | 'debug'

export interface FusionEvent {
    type: 'message' | 'action' | 'plan' | 'progress' | 'checkpoint'
    severity: EventSeverity
    timestamp: number
    source: string
    data: Record<string, unknown>
}

type ActionStatus = 'pending' | 'running' | 'done' | 'failed'

class EventStream extends EventEmitter {
    private history: FusionEvent[] = []
    private maxHistory: number = 1000

    emit(event: string, fusionEvent: FusionEvent): boolean {
        this.history.push(fusionEvent)
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory)
        }
        logForDebugging(`[event-stream] ${fusionEvent.type}/${fusionEvent.severity} from ${fusionEvent.source}`)
        return super.emit(event, fusionEvent)
    }

    emitAction(source: string, toolName: string, status: ActionStatus, detail?: string): void {
        this.emit('event', {
            type: 'action',
            severity: status === 'failed' ? 'critical' : 'info',
            timestamp: Date.now(),
            source,
            data: { toolName, status, detail: detail || '' },
        })
    }

    emitProgress(source: string, current: number, total: number, label: string): void {
        this.emit('event', {
            type: 'progress',
            severity: 'info',
            timestamp: Date.now(),
            source,
            data: { current, total, label, percent: total > 0 ? Math.round((current / total) * 100) : 0 },
        })
    }

    emitCheckpoint(source: string, label: string, data?: Record<string, unknown>): void {
        this.emit('event', {
            type: 'checkpoint',
            severity: 'info',
            timestamp: Date.now(),
            source,
            data: { label, ...data },
        })
    }

    emitPlan(source: string, steps: string[], currentStep: number): void {
        this.emit('event', {
            type: 'plan',
            severity: 'info',
            timestamp: Date.now(),
            source,
            data: { steps, currentStep, totalSteps: steps.length },
        })
    }

    getHistory(type?: FusionEvent['type']): FusionEvent[] {
        if (type) return this.history.filter(e => e.type === type)
        return [...this.history]
    }

    getRecent(count: number = 20): FusionEvent[] {
        return this.history.slice(-count)
    }

    clear(): void {
        this.history = []
    }
}

export const eventStream = new EventStream()
