import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js'
import { logForDebugging } from '../utils/debug.js'

export function isDeniedDomain(hostname: string): boolean {
    try {
        const config = SandboxManager.getNetworkRestrictionConfig()
        if (!config.deniedHosts || config.deniedHosts.length === 0) {
            return false
        }
        const hostLower = hostname.toLowerCase()
        for (const pattern of config.deniedHosts) {
            const patternLower = pattern.toLowerCase()
            if (hostLower === patternLower || hostLower.endsWith('.' + patternLower)) {
                logForDebugging(`[network] denied domain: ${hostname} matches pattern: ${pattern}`)
                return true
            }
        }
        return false
    } catch (error) {
        logForDebugging(`[network] domain check error: ${error}`)
        return false
    }
}
