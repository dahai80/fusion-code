const steer = {
    description: 'Inject follow-up input into the current turn (queued for next step)',
    name: 'steer',
    argumentHint: '<text>',
    type: 'local' as const,
    immediate: true,
    userInvocable: true,
    load: () => import('./steer.js'),
}

export default steer
