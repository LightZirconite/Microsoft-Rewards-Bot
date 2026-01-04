import axios from 'axios'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Config } from '../../interface/Config'

/**
 * Emergency kill switch for error reporting
 * Set to true to completely disable error reporting (bypasses all config)
 */
const ERROR_REPORTING_HARD_DISABLED = false

interface ErrorReportPayload {
    error: string
    stack?: string
    id?: string
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
    // Discord mention sanitization (prevent @everyone, @here abuse)
    [/@(everyone|here)/gi, '@\u200b$1'], // Zero-width space breaks mentions
    [/<@!?(\d+)>/g, '@user'], // User mentions
    [/<@&(\d+)>/g, '@role'], // Role mentions
    [/<#(\d+)>/g, '#channel'] // Channel mentions
]

function sanitizeSensitiveText(text: string): string {
    return SANITIZE_PATTERNS.reduce((acc, [pattern, replace]) => acc.replace(pattern, replace), text)
}

function normalizeForId(text: string): string {
    if (!text) return ''

    // Remove ISO timestamps
    let t = String(text).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, '')
    // Remove hex addresses / pointers
    t = t.replace(/0x[0-9a-fA-F]+/g, '')
    // Replace absolute paths with placeholder
    t = t.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s:]*)/g, '[PATH]')
    // Remove line/column numbers in stack traces (file:line:col)
    t = t.replace(/:\d+(?:[:]\d+)?/g, '')
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ').trim()
    return t
}

function computeErrorId(payload: { error: string; stack?: string; context?: Record<string, unknown>; additionalContext?: Record<string, unknown> }): string {
    const parts: string[] = []
    parts.push(normalizeForId(payload.error || ''))
    if (payload.stack) parts.push(normalizeForId(payload.stack))

    // Include context keys except timestamp to keep ID deterministic across runs/machines
    const ctx = payload.context || {}
    const ctxEntries = Object.keys(ctx).filter(k => k !== 'timestamp').sort().map(k => `${k}=${String(ctx[k])}`)
    parts.push(...ctxEntries)

    // Additional context sorted
    const add = payload.additionalContext || {}
    const addEntries = Object.keys(add).sort().map(k => `${k}=${String(add[k])}`)
    parts.push(...addEntries)

    const canonical = parts.join('|')
    const hash = crypto.createHash('sha256').update(canonical).digest('hex')
    return hash.slice(0, 12)
}

/**
 * Check if an error should be reported (filter false positives and user configuration errors)
 */
function shouldReportError(errorMessage: string): boolean {
    const lowerMessage = errorMessage.toLowerCase()

    // List of patterns that indicate user configuration errors (not reportable bugs)
    const userConfigPatterns = [
        /accounts\.jsonc.*not found/i,
        /config\.jsonc.*not found/i,
        /invalid.*credentials/i,
        /login.*failed/i,
        /authentication.*failed/i,
        /proxy.*connection.*failed/i,
        /totp.*invalid/i,
        /2fa.*failed/i,
        /incorrect.*password/i,
        /account.*suspended/i,
        /account.*banned/i,
        /no.*accounts.*enabled/i,
        /invalid.*configuration/i,
        /missing.*required.*field/i,
        /port.*already.*in.*use/i,
        /eaddrinuse/i,
        // Rebrowser-playwright expected errors (benign, non-fatal)
        /rebrowser-patches.*cannot get world/i,
        /session closed.*rebrowser/i,
        /addScriptToEvaluateOnNewDocument.*session closed/i,
        // User auth issues (not bot bugs)
        /password.*incorrect/i,
        /email.*not.*found/i,
        /account.*locked/i
    ]

    // Don't report user configuration errors
    for (const pattern of userConfigPatterns) {
        if (pattern.test(lowerMessage)) {
            return false
        }
    }

    // List of patterns that indicate expected/handled errors (not bugs)
    const expectedErrorPatterns = [
        /no.*points.*to.*earn/i,
        /already.*completed/i,
        /activity.*not.*available/i,
        /daily.*limit.*reached/i,
        /quest.*not.*found/i,
        /promotion.*expired/i,
        // Playwright expected errors (page lifecycle, navigation, timeouts)
        /target page.*context.*browser.*been closed/i,
        /page.*has been closed/i,
        /context.*has been closed/i,
        /browser.*has been closed/i,
        /execution context was destroyed/i,
        /frame was detached/i,
        /navigation.*cancelled/i,
        /timeout.*exceeded/i,
        /waiting.*failed.*timeout/i,
        /net::ERR_ABORTED/i,
        /net::ERR_CONNECTION_REFUSED/i,
        /net::ERR_NAME_NOT_RESOLVED/i
    ]

    // Don't report expected/handled errors
    for (const pattern of expectedErrorPatterns) {
        if (pattern.test(lowerMessage)) {
            return false
        }
    }

    // Report everything else (genuine bugs)
    return true
}

/**
 * Build the error report payload for Vercel API
 * Returns null if error should be filtered (prevents sending)
 */
function buildErrorReportPayload(error: Error | string, additionalContext?: Record<string, unknown>): ErrorReportPayload | null {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const sanitizedForLogging = sanitizeSensitiveText(errorMessage)

    if (!shouldReportError(errorMessage)) {
        process.stderr.write(`[ErrorReporting] Filtered error (expected/benign): ${sanitizedForLogging.substring(0, 100)}\n`)
        return null
    }

    const errorStack = error instanceof Error ? error.stack : undefined
    const sanitizedMessage = sanitizeSensitiveText(errorMessage)
    const sanitizedStack = errorStack ? sanitizeSensitiveText(errorStack).split('\n').slice(0, 15).join('\n') : undefined

    const context: ErrorReportPayload['context'] = {
        version: getProjectVersion(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        botMode: (additionalContext?.platform as string) || 'UNKNOWN'
    }

    // Sanitize additional context
    const sanitizedAdditionalContext: Record<string, unknown> = {}
    if (additionalContext) {
        for (const [key, value] of Object.entries(additionalContext)) {
            if (key === 'platform') continue // Already in context
            if (typeof value === 'string') {
                sanitizedAdditionalContext[key] = sanitizeSensitiveText(value)
            } else {
                sanitizedAdditionalContext[key] = value
            }
        }
    }

    const partialPayload = {
        error: sanitizedMessage,
        stack: sanitizedStack,
        context,
        additionalContext: Object.keys(sanitizedAdditionalContext).length > 0 ? sanitizedAdditionalContext : undefined
    }

    // Compute deterministic ID (exclude timestamp inside computeErrorId)
    const id = computeErrorId(partialPayload as { error: string; stack?: string; context?: Record<string, unknown>; additionalContext?: Record<string, unknown> })

    return {
        ...partialPayload,
        id
    }
}

/**
 * Send error report to Vercel API (sanitized, no sensitive data)
 */
export async function sendErrorReport(
    config: Config,
    error: Error | string,
    additionalContext?: Record<string, unknown>
): Promise<void> {
    // Hard-disabled flag (emergency kill switch)
    if (ERROR_REPORTING_HARD_DISABLED) {
        return Promise.resolve()
    }

    // Check if error reporting is enabled in config
    if (config.errorReporting?.enabled === false) {
        process.stderr.write('[ErrorReporting] Disabled in config (errorReporting.enabled = false)\n')
        return
    }

    process.stderr.write('[ErrorReporting] Enabled, processing error...\n')

    try {
        // Build error report payload (with sanitization)
        const payload = buildErrorReportPayload(error, additionalContext)
        if (!payload) {
            process.stderr.write('[ErrorReporting] Error was filtered (expected/benign), skipping report\n')
            return
        }

        // Determine API endpoint URL
        const defaultApiUrl = 'https://microsoft-rewards-bot.vercel.app/api/report-error'
        const apiUrl = config.errorReporting?.apiUrl || defaultApiUrl
        const rateLimitSecret = config.errorReporting?.secret

        process.stderr.write(`[ErrorReporting] Sending to API: ${apiUrl}\n`)

        // Build request headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

        if (rateLimitSecret) {
            headers['X-Rate-Limit-Secret'] = rateLimitSecret
        }

        // Send to Vercel API with timeout
        const response = await axios.post(apiUrl, payload, {
            headers,
            timeout: 15000 // 15 second timeout
        })

        if (response.status === 200) {
            process.stderr.write('[ErrorReporting] ✅ Error report sent successfully\n')
        } else {
            process.stderr.write(`[ErrorReporting] ⚠️ Unexpected response status: ${response.status}\n`)
        }

    } catch (apiError) {
        // Handle API errors gracefully (don't throw - error reporting is non-critical)
        let errorMsg = ''
        let httpStatus: number | null = null

        if (apiError && typeof apiError === 'object' && 'response' in apiError) {
            const axiosError = apiError as { response?: { status: number; data?: unknown } }
            httpStatus = axiosError.response?.status || null

            // Extract error message from response if available
            if (axiosError.response?.data && typeof axiosError.response.data === 'object' && 'message' in axiosError.response.data) {
                errorMsg = String((axiosError.response.data as { message: string }).message)
            }
        }

        // Handle specific HTTP status codes
        if (httpStatus === 429) {
            process.stderr.write(`[ErrorReporting] ⚠️ Rate limit exceeded (HTTP 429): ${errorMsg || 'Too many requests'}\n`)
            return
        }

        if (httpStatus === 400) {
            process.stderr.write(`[ErrorReporting] ❌ Invalid payload (HTTP 400): ${errorMsg || 'Check error report format'}\n`)
            return
        }

        if (httpStatus === 502 || (httpStatus && httpStatus >= 500)) {
            process.stderr.write(`[ErrorReporting] ⚠️ Server error (HTTP ${httpStatus}): ${errorMsg || 'Vercel or Discord webhook unavailable'}\n`)
            return
        }

        // Generic error logging
        if (!errorMsg) {
            errorMsg = apiError instanceof Error ? apiError.message : String(apiError)
        }

        process.stderr.write(`[ErrorReporting] ❌ Failed to send error report: ${sanitizeSensitiveText(errorMsg)}\n`)

        // Network connectivity hints
        if (apiError instanceof Error && (apiError.message.includes('ENOTFOUND') || apiError.message.includes('ECONNREFUSED'))) {
            process.stderr.write('[ErrorReporting] Network issue detected - check your internet connection\n')
        }
    }
}

/**
 * Get project version from package.json
 * Tries multiple paths to handle both development and production environments
 */
function getProjectVersion(): string {
    try {
        // Try multiple possible paths (dev and compiled)
        const possiblePaths = [
            path.join(__dirname, '../../../package.json'),  // From dist/util/notifications/
            path.join(__dirname, '../../package.json'),     // From src/util/notifications/
            path.join(process.cwd(), 'package.json')        // From project root
        ]

        for (const pkgPath of possiblePaths) {
            try {
                if (fs.existsSync(pkgPath)) {
                    const raw = fs.readFileSync(pkgPath, 'utf-8')
                    const pkg = JSON.parse(raw) as { version?: string }
                    if (pkg.version) {
                        return pkg.version
                    }
                }
            } catch {
                // Try next path
                continue
            }
        }

        return 'unknown'
    } catch {
        return 'unknown'
    }
}
