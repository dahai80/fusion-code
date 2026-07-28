import { describe, it, expect } from 'bun:test'

function computeShouldShowModeHint(params: {
    isCoordinator: boolean
    hasActiveMode: boolean
    hasBackgroundTasks: boolean
    hasTeams: boolean
    showHint: boolean
}): boolean {
    const primaryItemCount =
        (params.isCoordinator || params.hasActiveMode ? 1 : 0) +
        (params.hasBackgroundTasks ? 1 : 0) +
        (params.hasTeams ? 1 : 0)
    return primaryItemCount < 2 && params.showHint
}

describe('shouldShowModeHint visibility logic', () => {
    it('should show hint when no primary items and showHint is true', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: false,
            hasBackgroundTasks: false,
            hasTeams: false,
            showHint: true,
        })).toBe(true)
    })

    it('should show hint with 1 primary item and showHint is true', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: true,
            hasBackgroundTasks: false,
            hasTeams: false,
            showHint: true,
        })).toBe(true)
    })

    it('should hide hint when showHint is false (user typing)', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: false,
            hasBackgroundTasks: false,
            hasTeams: false,
            showHint: false,
        })).toBe(false)
    })

    it('should hide hint when 2 primary items even if showHint is true', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: true,
            hasBackgroundTasks: true,
            hasTeams: false,
            showHint: true,
        })).toBe(false)
    })

    it('should hide hint when 3 primary items even if showHint is true', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: true,
            hasActiveMode: true,
            hasBackgroundTasks: true,
            hasTeams: true,
            showHint: true,
        })).toBe(false)
    })

    it('should hide hint when 2 primary items and showHint is false', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: true,
            hasBackgroundTasks: true,
            hasTeams: false,
            showHint: false,
        })).toBe(false)
    })

    it('should show hint with 1 item from hasTeams', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: false,
            hasBackgroundTasks: false,
            hasTeams: true,
            showHint: true,
        })).toBe(true)
    })

    it('should hide hint when typing with 1 primary item', () => {
        expect(computeShouldShowModeHint({
            isCoordinator: false,
            hasActiveMode: true,
            hasBackgroundTasks: false,
            hasTeams: false,
            showHint: false,
        })).toBe(false)
    })
})
