import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { Config } from '../../interface/Config'

/**
 * Emergency kill switch for error reporting
 */
const ERROR_REPORTING_HARD_DISABLED = false

/**
 * In-memory auth cache (per execution)
 */
let cachedAuthorization: string | null = null
let authExpiresAt = 0
let registerInFlight: Promise<void> | null = null
let cachedProjectVersion: string | null = null

interface ErrorReportPayload {
    error: string
    stack?: string
    context: {
        version: string
        platform: string
        arch: string
        nodeVersion: string
        timestamp: string
        botMode?: string
    }
    additionalContext?: Record<string, unknown>
}

const SANITIZE_PATTERNS: Array<[RegExp, string]> = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]'],
    [/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '[PATH_REDACTED]'],
    [/\/(?:home|Users)\/[^/\s]+(?:\/[^/\s]+)*/g, '[PATH_REDACTED]'],
    [/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '[IP_REDACTED]'],
    [/\b[A-Za-z0-9_-]{20,}\b/g, '[TOKEN_REDACTED]'],
    [/@(everyone|here)/gi, '@\u200b$1'],
    [/<@!?(\d+)>/g, '@user'],
    [/<@&(\d+)>/g, '@role'],
    [/<#(\d+)>/g, '#channel']
]

function sanitizeSensitiveText(text: string): string {
    return SANITIZE_PATTERNS.reduce(
        (acc, [pattern, replace]) => acc.replace(pattern, replace),
        text
    )
}

/**
 * Register once per execution and cache Authorization
 */
async function ensureAuthorization(apiUrl: string): Promise<void> {
    const now = Date.now()

    if (cachedAuthorization && now < authExpiresAt - 10_000) {
        return
    }

    if (registerInFlight) {
        return registerInFlight
    }

    registerInFlight = (async () => {
        const registerUrl = apiUrl.replace(/\/report-error$/, '/register')

        const res = await axios.post(registerUrl, null, {
            timeout: 10_000
        })

        if (!res.data?.authorization || !res.data?.expiresAt) {
            throw new Error('Invalid register response')
        }

        cachedAuthorization = res.data.authorization
        authExpiresAt = res.data.expiresAt
    })()

    try {
        await registerInFlight
    } finally {
        registerInFlight = null
    }
}

/**
 * Determine whether an error should be reported
 */
function shouldReportError(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase()

    const ignoredPatterns = [
        /invalid.*credentials/i,
        /authentication.*failed/i,
        /incorrect.*password/i,
        /account.*banned/i,
        /account.*locked/i,
        /timeout.*exceeded/i,
        /net::ERR_/i,
        /already.*completed/i,
        /navigation.*timeout/i,
        /element.*not.*found/i,
        /page.*crashed/i,
        /browser.*closed/i
    ]

    return !ignoredPatterns.some(p => p.test(lower))
}

/**
 * Build sanitized payload
 */
function buildErrorReportPayload(
    error: Error | string,
    additionalContext?: Record<string, unknown>
): ErrorReportPayload | null {
    const message = error instanceof Error ? error.message : String(error)

    if (!shouldReportError(message)) {
        return null
    }

    const stack = error instanceof Error ? error.stack : undefined

    const context: ErrorReportPayload['context'] = {
        version: getProjectVersion(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        botMode: (additionalContext?.platform as string) || 'UNKNOWN'
    }

    const sanitizedAdditional: Record<string, unknown> = {}

    if (additionalContext) {
        for (const [key, value] of Object.entries(additionalContext)) {
            if (typeof value === 'string') {
                sanitizedAdditional[key] = sanitizeSensitiveText(value)
            } else {
                sanitizedAdditional[key] = value
            }
        }
    }

    return {
        error: sanitizeSensitiveText(message),
        stack: stack
            ? sanitizeSensitiveText(stack).split('\n').slice(0, 15).join('\n')
            : undefined,
        context,
        additionalContext:
            Object.keys(sanitizedAdditional).length > 0
                ? sanitizedAdditional
                : undefined
    }
}

/**
 * Send error report (signed + time-limited Authorization)
 */
export async function sendErrorReport(
    config: Config,
    error: Error | string,
    additionalContext?: Record<string, unknown>
): Promise<string | null> {
    if (ERROR_REPORTING_HARD_DISABLED) return null
    if (config.errorReporting?.enabled === false) return null

    try {
        const payload = buildErrorReportPayload(error, additionalContext)
        if (!payload) return null

        const apiUrl =
            config.errorReporting?.apiUrl || // Main API Url
            'https://microsoft-rewards-bot.vercel.app/api/report-error' // Fallback URL

        await ensureAuthorization(apiUrl)

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: cachedAuthorization!
        }

        const response = await axios.post(apiUrl, payload, {
            headers,
            timeout: 15_000
        })

        return response.data?.id || null
    } catch {
        // Error reporting must NEVER throw
        return null
    }
}

/**
 * Resolve project version safely (cached)
 */
function getProjectVersion(): string {
    if (cachedProjectVersion) return cachedProjectVersion

    const paths = [
        path.join(process.cwd(), 'package.json'),
        path.join(__dirname, '../../../package.json'),
        path.join(__dirname, '../../package.json')
    ]

    for (const p of paths) {
        try {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf-8')
                const pkg = JSON.parse(raw)
                if (pkg?.version) {
                    cachedProjectVersion = pkg.version
                    return pkg.version
                }
            }
        } catch {
            continue
        }
    }

    cachedProjectVersion = 'unknown'
    return 'unknown'
}