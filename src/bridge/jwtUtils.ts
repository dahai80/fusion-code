export function decodeJwtExpiry(token: string): number | null {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const payloadB64 = parts[1]
        // Base64url decode
        const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
        const padNeeded = (4 - (padded.length % 4)) % 4
        const paddedFull = padded + '='.repeat(padNeeded)
        const payloadStr = Buffer.from(paddedFull, 'base64').toString('utf-8')
        const payload = JSON.parse(payloadStr)
        if (typeof payload.exp === 'number') {
            return payload.exp
        }
        return null
    } catch {
        return null
    }
}
