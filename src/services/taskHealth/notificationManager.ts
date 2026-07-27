import { logForDebugging } from '../../utils/debug.js'

export type TaskNotificationEvent =
    | 'completed'
    | 'failed'
    | 'timed_out'
    | 'killed'
    | 'lost'

export type TaskNotificationSeverity = 'success' | 'error' | 'warning' | 'info'

export type TaskNotification = {
    taskId: string
    taskType: string
    event: TaskNotificationEvent
    severity: TaskNotificationSeverity
    summary: string
    timestamp: number
    read: boolean
}

const SEVERITY_MAP: Record<TaskNotificationEvent, TaskNotificationSeverity> = {
    completed: 'success',
    failed: 'error',
    timed_out: 'warning',
    killed: 'info',
    lost: 'error',
}

type NotificationKey = string

function makeKey(taskId: string, event: TaskNotificationEvent): NotificationKey {
    return `${taskId}::${event}`
}

const MAX_NOTIFICATIONS = 100

export class TaskNotificationManager {
    private notifications: Map<NotificationKey, TaskNotification> = new Map()

    publish(params: {
        taskId: string
        taskType: string
        event: TaskNotificationEvent
        summary: string
    }): TaskNotification {
        const key = makeKey(params.taskId, params.event)
        const existing = this.notifications.get(key)
        if (existing) {
            logForDebugging('task-notification-dedup', { taskId: params.taskId, event: params.event })
            return existing
        }

        const notification: TaskNotification = {
            taskId: params.taskId,
            taskType: params.taskType,
            event: params.event,
            severity: SEVERITY_MAP[params.event],
            summary: params.summary,
            timestamp: Date.now(),
            read: false,
        }
        this.notifications.set(key, notification)

        if (this.notifications.size > MAX_NOTIFICATIONS) {
            const oldest = [...this.notifications.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
            for (let i = 0; i < oldest.length - MAX_NOTIFICATIONS; i++) {
                this.notifications.delete(oldest[i][0])
            }
        }

        logForDebugging('task-notification-published', { taskId: params.taskId, event: params.event })
        return notification
    }

    getNotifications(): TaskNotification[] {
        return [...this.notifications.values()].sort((a, b) => b.timestamp - a.timestamp)
    }

    getUnread(): TaskNotification[] {
        return this.getNotifications().filter(n => !n.read)
    }

    hasUnread(): boolean {
        return [...this.notifications.values()].some(n => !n.read)
    }

    markRead(taskId?: string): void {
        for (const n of this.notifications.values()) {
            if (!taskId || n.taskId === taskId) {
                n.read = true
            }
        }
    }

    clear(taskId?: string): void {
        if (!taskId) {
            this.notifications.clear()
            return
        }
        for (const [key, n] of this.notifications.entries()) {
            if (n.taskId === taskId) {
                this.notifications.delete(key)
            }
        }
    }

    unreadCount(): number {
        return [...this.notifications.values()].filter(n => !n.read).length
    }
}

let _instance: TaskNotificationManager | null = null

export function getNotificationManager(): TaskNotificationManager {
    if (!_instance) {
        _instance = new TaskNotificationManager()
    }
    return _instance
}
