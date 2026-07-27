const btw = {
    description: 'Ask a side question without interrupting the main workflow',
    name: 'btw',
    argumentHint: '<question>',
    type: 'local' as const,
    immediate: true,
    userInvocable: true,
    load: () => import('./btw.js'),
}

export default btw
