import { logForDebugging } from './debug.js'

const AWS_KEY_PATTERN = /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g
const AWS_SECRET_PATTERN = /(?:aws_secret_access_key\s*=\s*|AWS_SECRET_ACCESS_KEY=)['"]?([A-Za-z0-9/+=]{40})['"]?/gi
const GITHUB_TOKEN_PATTERN = /gh[ps]_[A-Za-z0-9_]{36,255}/g
const SLACK_TOKEN_PATTERN = /xox[bposa]-[0-9a-zA-Z-]{10,}/g
const PRIVATE_KEY_PATTERN = /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g
const GENERIC_API_KEY_PATTERN = /(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?key)\s*[:=]\s*['"]?([A-Za-z0-9\-_.]{20,})['"]?/gi
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/g
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const CONNECTION_STRING_PATTERN = /(?:mongodb|postgres|mysql|redis|amqp)(?:\+[\w]+)?:\/\/[^\s'"]+/gi
const HEROKU_API_KEY_PATTERN = /(?:heroku|hk)_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g
const STRIPE_KEY_PATTERN = /(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}/g
const SENDGRID_KEY_PATTERN = /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g
const TWILIO_KEY_PATTERN = /SK[0-9a-fA-F]{32}/g
const GOOGLE_OAUTH_PATTERN = /[0-9]+-[a-z0-9_]{32}\.apps\.googleusercontent\.com/gi

const ALL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: AWS_KEY_PATTERN, label: 'AWS_ACCESS_KEY' },
    { pattern: AWS_SECRET_PATTERN, label: 'AWS_SECRET_KEY' },
    { pattern: GITHUB_TOKEN_PATTERN, label: 'GITHUB_TOKEN' },
    { pattern: SLACK_TOKEN_PATTERN, label: 'SLACK_TOKEN' },
    { pattern: PRIVATE_KEY_PATTERN, label: 'PRIVATE_KEY' },
    { pattern: BEARER_TOKEN_PATTERN, label: 'BEARER_TOKEN' },
    { pattern: JWT_PATTERN, label: 'JWT' },
    { pattern: CONNECTION_STRING_PATTERN, label: 'CONNECTION_STRING' },
    { pattern: HEROKU_API_KEY_PATTERN, label: 'HEROKU_KEY' },
    { pattern: STRIPE_KEY_PATTERN, label: 'STRIPE_KEY' },
    { pattern: SENDGRID_KEY_PATTERN, label: 'SENDGRID_KEY' },
    { pattern: TWILIO_KEY_PATTERN, label: 'TWILIO_KEY' },
    { pattern: GOOGLE_OAUTH_PATTERN, label: 'GOOGLE_OAUTH' },
    { pattern: GENERIC_API_KEY_PATTERN, label: 'API_KEY' },
]

export interface CredentialRedactionResult {
    redacted: string
    foundTypes: string[]
    redactionCount: number
}

const REDACTION_REPLACEMENT = '[REDACTED_$1]'

export function redactCredentials(input: string): CredentialRedactionResult {
    if (!input || typeof input !== 'string') {
        return { redacted: input, foundTypes: [], redactionCount: 0 }
    }

    const foundTypes: string[] = []
    let result = input
    let totalRedactions = 0

    for (const { pattern, label } of ALL_PATTERNS) {
        const matches = result.match(pattern)
        if (matches && matches.length > 0) {
            if (!foundTypes.includes(label)) {
                foundTypes.push(label)
            }
            totalRedactions += matches.length
            result = result.replace(pattern, REDACTION_REPLACEMENT.replace('$1', label))
        }
    }

    if (totalRedactions > 0) {
        logForDebugging(`[CredentialSandbox] Redacted ${totalRedactions} credential(s) of type: ${foundTypes.join(', ')}`)
    }

    return {
        redacted: result,
        foundTypes,
        redactionCount: totalRedactions,
    }
}

export function isCredentialSandboxEnabled(): boolean {
    const val = process.env.FUSION_CREDENTIAL_SANDBOX
    if (val === '0' || val === 'false') return false
    return val === '1' || val === 'true'
}

export function shouldRedactToolOutput(toolName: string): boolean {
    if (!isCredentialSandboxEnabled()) return false
    const skipTools = new Set([
        'TodoRead', 'TodoWrite', 'TaskCreate', 'TaskUpdate',
        'TaskList', 'TaskGet', 'ToolSearch',
    ])
    return !skipTools.has(toolName)
}
