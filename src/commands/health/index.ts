const health = {
    description: 'Task health overview and recovery (/health, /health recover, /health kill-all)',
    name: 'health',
    aliases: ['task-health'],
    argumentHint: '[recover|kill-all]',
    type: 'local' as const,
    userInvocable: true,
    load: () => import('./health.js'),
}

export default health
