import React from 'react'

// Stub for internal-only Ant model switch callout.
// Real implementation only exists in the internal repo.

export function shouldShowModelSwitchCallout(): boolean {
    return false
}

export function AntModelSwitchCallout(_props: { onDone: (selection: string, modelAlias?: string) => void }): React.ReactElement | null {
    return null
}
