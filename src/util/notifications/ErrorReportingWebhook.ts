import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { DISCORD } from '../../constants'
import { Config } from '../../interface/Config'

const ERROR_REPORTING_HARD_DISABLED = true

interface DiscordEmbed {
    title: string
    description: string
    color: number
    fields: Array<{ name: string; value: string; inline: boolean }>
    timestamp: string
    footer: { text: string; icon_url: string }
}

interface ErrorReportPayload {
    error: string
    stack?: string
    context: {
        version: string
        platform: string
        arch: string
        nodeVersion: string
        timestamp: string
        botMode?: string  // DESKTOP, MOBILE, or MAIN
    }
}

const SANITIZE_PATTERNS: Array<[RegExp, string]> = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]'],
    [/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '[PATH_REDACTED]'],
    [/\/(?:home|Users)\/[^/\s]+(?:\/[^/\s]+)*/g, '[PATH_REDACTED]'],
    [/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '[IP_REDACTED]'],
    [/\b[A-Za-z0-9_-]{20,}\b/g, '[TOKEN_REDACTED]']
]

function sanitizeSensitiveText(text: string): string {
    return SANITIZE_PATTERNS.reduce((acc, [pattern, replace]) => acc.replace(pattern, replace), text)
}

/**
 * Build the Discord payload from error and context (sanitizes content)
 * Returns null if error should be filtered (prevents sending)
 */
function buildDiscordPayload(config: Config, error: Error | string, additionalContext?: Record<string, unknown>): { username: string; avatar_url?: string; embeds: DiscordEmbed[] } | null {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const sanitizedForLogging = sanitizeSensitiveText(errorMessage)

    if (!shouldReportError(errorMessage)) {
        process.stderr.write(`[ErrorReporting] Filtered error (expected/benign): ${sanitizedForLogging.substring(0, 100)}\n`)
        return null // FIXED: Return null instead of sending dummy message
    }

    const errorStack = error instanceof Error ? error.stack : undefined

    const sanitizedMessage = sanitizeSensitiveText(errorMessage)
    const sanitizedStack = errorStack ? sanitizeSensitiveText(errorStack).split('\n').slice(0, 10).join('\n') : undefined

    const payloadContext: ErrorReportPayload['context'] = {
        version: getProjectVersion(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        botMode: (additionalContext?.platform as string) || 'UNKNOWN'
    }

    if (additionalContext) {
        for (const [key, value] of Object.entries(additionalContext)) {
            if (typeof value === 'string') {
                (payloadContext as Record<string, unknown>)[key] = sanitizeSensitiveText(value)
            } else {
                (payloadContext as Record<string, unknown>)[key] = value
            }
        }
    }

    const osPlatform = (() => {
        // Basic platform formatting
        switch (payloadContext.platform) {
            case 'win32': return '🪟 Windows'
            case 'darwin': return '🍎 macOS'
            case 'linux': return '🐧 Linux'
            default: return payloadContext.platform
        }
    })()

    const embed: DiscordEmbed = {
        title: '🐛 Automatic Error Report',
        description: `\`\`\`js\n${sanitizedMessage.slice(0, 700)}\n\`\`\``,
        color: DISCORD.COLOR_RED,
        fields: [
            { name: '📦 Version', value: payloadContext.version === 'unknown' ? '⚠️ Unknown (check package.json)' : `v${payloadContext.version}`, inline: true },
            { name: '🤖 Bot Mode', value: payloadContext.botMode || 'UNKNOWN', inline: true },
            { name: '💻 OS Platform', value: `${osPlatform} ${payloadContext.arch}`, inline: true },
            { name: '⚙️ Node.js', value: payloadContext.nodeVersion, inline: true },
            { name: '🕐 Timestamp', value: new Date(payloadContext.timestamp).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' }), inline: false }
        ],
        timestamp: payloadContext.timestamp,
        footer: { text: 'Automatic error reporting • Non-sensitive data only', icon_url: DISCORD.AVATAR_URL }
    }

    if (sanitizedStack) {
        const truncated = sanitizedStack.slice(0, 900)
        const wasTruncated = sanitizedStack.length > 900
        embed.fields.push({ name: '📋 Stack Trace' + (wasTruncated ? ' (truncated for display)' : ''), value: `\`\`\`js\n${truncated}${wasTruncated ? '\n... (see full trace in logs)' : ''}\n\`\`\``, inline: false })
    }

    if (additionalContext) {
        for (const [key, value] of Object.entries(additionalContext)) {
            if (embed.fields.length < 25) embed.fields.push({ name: key, value: sanitizeSensitiveText(String(value)).slice(0, 1024), inline: true })
        }
    }

    return { username: 'Microsoft-Rewards-Bot Error Reporter', avatar_url: DISCORD.AVATAR_URL, embeds: [embed] }
}

/**
 * Simple obfuscation/deobfuscation for webhook URL
 * Not for security, just to avoid easy scraping
 */
/**
 * Obfuscation helpers
 * - If `ERROR_WEBHOOK_KEY` is provided, `obfuscateWebhookUrl` will return `ENC:<base64>`
 *   where the payload is AES-256-GCM(iv|tag|ciphertext).
 * - Otherwise it returns `B64:<base64>` (simple base64) to avoid storing plain URLs.
 */
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function getEncryptionKey(): Buffer | null {
    const keyStr = process.env.ERROR_WEBHOOK_KEY || ''
    if (!keyStr) return null
    return crypto.createHash('sha256').update(keyStr, 'utf8').digest()
}

export function obfuscateWebhookUrl(url: string): string {
    const key = getEncryptionKey()
    if (!key) {
        return 'B64:' + Buffer.from(url, 'utf8').toString('base64')
    }

    try {
        const iv = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
        const ciphertext = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()])
        const tag = cipher.getAuthTag()
        const out = Buffer.concat([iv, tag, ciphertext]).toString('base64')
        return 'ENC:' + out
    } catch {
        // Fallback to base64 if encryption fails
        return 'B64:' + Buffer.from(url, 'utf8').toString('base64')
    }
}

export function deobfuscateWebhookUrl(encoded: string): string {
    const trimmed = (encoded || '').trim()
    if (!trimmed) return ''

    // ENC: prefixed encrypted value (AES-256-GCM)
    if (trimmed.startsWith('ENC:')) {
        const payload = trimmed.slice(4)
        const key = getEncryptionKey()
        if (!key) return ''
        try {
            const buf = Buffer.from(payload, 'base64')
            const iv = buf.slice(0, 12)
            const tag = buf.slice(12, 28)
            const ciphertext = buf.slice(28)
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
            decipher.setAuthTag(tag)
            const res = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
            return res
        } catch {
            return ''
        }
    }

    // B64: prefixed base64 value
    if (trimmed.startsWith('B64:')) {
        try {
            return Buffer.from(trimmed.slice(4), 'base64').toString('utf8')
        } catch {
            return ''
        }
    }

    // Backwards compatibility: raw base64 without prefix
    if (BASE64_REGEX.test(trimmed)) {
        try {
            return Buffer.from(trimmed, 'base64').toString('utf8')
        } catch {
            return ''
        }
    }

    return ''
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

// Internal webhooks stored obfuscated to avoid having raw URLs in the repository.
// We store them as `B64:<base64>` entries. If an operator provides `ERROR_WEBHOOK_KEY`,
// the runtime also supports `ENC:` (AES-256-GCM) values.
// UPDATED: 2025-12-22 with new webhook URLs (4 redundancy webhooks)
const INTERNAL_ERROR_WEBHOOKS = [
    'B64:aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1MjMzMDQ4NzExMTc0OTc1NS9XcWZod3dHYWVpRUtpVWdiM1JFQUlFWWl6Wlkzcm1jOWRiWE5QbHd1NTVuTEpjenZzWjB1ODlQSm9Lb1NpYzFZaUxqWQ==',
    'B64:aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1MjMzMDU4OTE4MDEzMzQ0OC9EMVdkS190T3FoRmxMeDhSaTJrdk9jOUdvOWhqalZFODZPeUFuX0NkRkVORGd1MG81bVl5MVdubllZc3I1LWxBOG12',
    'B64:aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1MjMzMDY1Nzc2OTU5MDg5Ni94Q0pQay1YWmNqWEp0NW90N2R6bGoweTJDTFpFVTdJaHhSdzdSazNNUjhoaHhidEJvQTdmbktpV2RuMFJaMC1VN3FBSUxV',
    'B64:aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTQ1MjMzMDcxMTcyOTA0OTYyMC9yNFRsVkY5aHRiOUR1ejE3WEF6YW5RdXB5OVVkX19XLW03bk4xQUR3Tk9XcllvN1lWNEdUaVU5ejhoQ1FoWXdvNkwyTQ=='
]

// Track disabled webhooks as encoded entries during this execution (in-memory and persisted)
// Stored form maps encoded string -> timestamp
const disabledEncodedWebhooks = new Map<string, number>()
let lastSuccessfulEncoded: string | null = null
const DISABLED_WEBHOOKS_FILE = path.join(process.cwd(), 'sessions', 'disabled-webhooks.json')
const DISABLED_WEBHOOK_TTL = 60 * 60 * 1000 // 1 hour

function loadDisabledWebhooksFromDisk() {
    try {
        if (fs.existsSync(DISABLED_WEBHOOKS_FILE)) {
            const raw = fs.readFileSync(DISABLED_WEBHOOKS_FILE, 'utf8')
            const parsed = JSON.parse(raw) as { disabled?: Record<string, number>, lastSuccess?: string }
            if (parsed.disabled) {
                const cutoff = Date.now() - DISABLED_WEBHOOK_TTL
                for (const [encoded, timestamp] of Object.entries(parsed.disabled)) {
                    if (typeof timestamp === 'number' && timestamp >= cutoff) {
                        disabledEncodedWebhooks.set(encoded, timestamp)
                    }
                }
            }
            if (parsed.lastSuccess && typeof parsed.lastSuccess === 'string') {
                lastSuccessfulEncoded = parsed.lastSuccess
            }
        }
    } catch {
        // ignore
    }
}

function saveDisabledWebhooksToDisk() {
    try {
        const dir = path.dirname(DISABLED_WEBHOOKS_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const payload = {
            disabled: Object.fromEntries(disabledEncodedWebhooks),
            lastSuccess: lastSuccessfulEncoded
        }
        fs.writeFileSync(DISABLED_WEBHOOKS_FILE, JSON.stringify(payload, null, 2), 'utf8')
    } catch {
        // ignore
    }
}

function pruneExpiredDisabledWebhooks() {
    const now = Date.now()
    for (const [encoded, timestamp] of Array.from(disabledEncodedWebhooks.entries())) {
        if (now - timestamp > DISABLED_WEBHOOK_TTL) {
            disabledEncodedWebhooks.delete(encoded)
        }
    }
}

function isTemporarilyDisabled(encoded: string): boolean {
    const ts = disabledEncodedWebhooks.get(encoded)
    if (!ts) return false
    if (Date.now() - ts > DISABLED_WEBHOOK_TTL) {
        disabledEncodedWebhooks.delete(encoded)
        return false
    }
    return true
}

function markTemporarilyDisabled(encoded: string): void {
    disabledEncodedWebhooks.set(encoded, Date.now())
}

// Load persisted state at module init
loadDisabledWebhooksFromDisk()

/**
 * Disable error reporting temporarily for this execution
 * Used when webhook is deleted (404) - no need to keep trying
 */
export function disableErrorReportingTemporary(): void {
    // Disable all internal webhooks for this execution (persist encoded markers)
    for (const encoded of INTERNAL_ERROR_WEBHOOKS) {
        markTemporarilyDisabled(encoded)
    }
    saveDisabledWebhooksToDisk()
    process.stderr.write('[ErrorReporting] ⚠️ Disabled internal webhooks temporarily for this execution (webhook(s) may no longer be available)\n')
}

/**
 * Send error report to Discord webhook for community contribution
 * Only sends non-sensitive error information to help improve the project
 */
export async function sendErrorReport(
    config: Config,
    error: Error | string,
    additionalContext?: Record<string, unknown>
): Promise<void> {
    // Error reporting not available as 12/26/2025 because of vulnerabilities
    // View here: https://ptb.discord.com/channels/1418201715009912866/1418201717098418249/1454198384813412534
    if (ERROR_REPORTING_HARD_DISABLED) {
		return Promise.resolve()
	}
	
    // Check if error reporting is enabled
    if (config.errorReporting?.enabled === false) {
        process.stderr.write('[ErrorReporting] Disabled in config (errorReporting.enabled = false)\n')
        return
    }

    // Log that error reporting is enabled
    process.stderr.write('[ErrorReporting] Enabled, processing error...\n')
    
    try {
        pruneExpiredDisabledWebhooks()
        // Build candidate webhook list:
        // - If config provides webhooks, prefer them (accepts plain or base64-encoded values)
        // - Else fall back to internal hardcoded list
        const candidateEncodedWebhooks: string[] = []

        if (Array.isArray(config.errorReporting?.webhooks) && config.errorReporting.webhooks.length > 0) {
            for (const entry of config.errorReporting!.webhooks!) {
                if (typeof entry === 'string' && entry.trim()) {
                    // If the string looks like a full URL, obfuscate it to keep downstream decoding simple
                    if (entry.startsWith('http')) {
                        candidateEncodedWebhooks.push(obfuscateWebhookUrl(entry))
                    } else {
                        // Assume already encoded (base64)
                        candidateEncodedWebhooks.push(entry)
                    }
                }
            }
        }

        if (candidateEncodedWebhooks.length === 0) {
            candidateEncodedWebhooks.push(...INTERNAL_ERROR_WEBHOOKS)
        }

        // Attempt each webhook in order until one succeeds
        let lastError: unknown = null
        let sent = false

        // Prefer the last successful webhook if available
        if (lastSuccessfulEncoded) {
            const idx = candidateEncodedWebhooks.indexOf(lastSuccessfulEncoded)
            if (idx > 0) {
                candidateEncodedWebhooks.splice(idx, 1)
                candidateEncodedWebhooks.unshift(lastSuccessfulEncoded)
            }
        }

        for (const encoded of candidateEncodedWebhooks) {
            const webhookUrl = deobfuscateWebhookUrl(encoded)
            if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
                continue
            }

            if (isTemporarilyDisabled(encoded)) {
                process.stderr.write(`[ErrorReporting] Skipping disabled webhook: ${webhookUrl}\n`)
                continue
            }

            process.stderr.write(`[ErrorReporting] Trying webhook: ${webhookUrl}\n`)

            try {
                // FIXED: Check if payload is null (filtered error)
                const payload = buildDiscordPayload(config, error, additionalContext)
                if (!payload) {
                    process.stderr.write('[ErrorReporting] Skipping webhook send (error was filtered)\n')
                    sent = true // Mark as "sent" to prevent fallback error message
                    break
                }

                const response = await axios.post(webhookUrl, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                })

                process.stderr.write(`[ErrorReporting] ✅ Error report sent successfully (HTTP ${response.status})\n`)
                // mark success and persist
                lastSuccessfulEncoded = encoded
                saveDisabledWebhooksToDisk()
                sent = true
                break
            } catch (webhookError) {
                lastError = webhookError

                let httpStatus: number | null = null
                if (webhookError && typeof webhookError === 'object' && 'response' in webhookError) {
                    const axiosError = webhookError as { response?: { status: number } }
                    httpStatus = axiosError.response?.status || null
                }

                if (httpStatus === 404) {
                    markTemporarilyDisabled(encoded)
                    saveDisabledWebhooksToDisk()
                    process.stderr.write(`[ErrorReporting] ❌ Webhook not found (404): ${webhookUrl} - disabling for this run\n`)
                    continue
                }

                if (httpStatus === 401 || httpStatus === 403) {
                    markTemporarilyDisabled(encoded)
                    saveDisabledWebhooksToDisk()
                    process.stderr.write(`[ErrorReporting] ❌ Webhook auth failed (HTTP ${httpStatus}): ${webhookUrl} - disabling for this run\n`)
                    continue
                }

                if (httpStatus && httpStatus >= 500) {
                    process.stderr.write(`[ErrorReporting] ⚠️ Discord server error (HTTP ${httpStatus}) for webhook ${webhookUrl} - will try next webhook\n`)
                    continue
                }

                const webhookErrorMessage = webhookError instanceof Error ? webhookError.message : String(webhookError)
                process.stderr.write(`[ErrorReporting] ❌ Failed to send error report to ${webhookUrl}: ${sanitizeSensitiveText(webhookErrorMessage)}\n`)
                // try next webhook (small delay to avoid burst)
                await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 300)))
            }
        }

        if (!sent) {
            // If none succeeded, fall back to logging the failure
            const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError)
            process.stderr.write('[ErrorReporting] ❌ All webhook attempts failed. Last error: ' + sanitizeSensitiveText(lastErrorMessage) + '\n')
        }
        return
    } catch (webhookError) {
        // Enhanced error handling - detect specific HTTP errors
        let errorMsg = ''
        let httpStatus: number | null = null

        if (webhookError && typeof webhookError === 'object' && 'response' in webhookError) {
            const axiosError = webhookError as { response?: { status: number } }
            httpStatus = axiosError.response?.status || null
        }

        // Handle specific error cases
        if (httpStatus === 404) {
            // Webhook was deleted - disable error reporting for this execution
            errorMsg = 'Webhook not found (404) - was it deleted? Disabling error reporting for this run.'
            disableErrorReportingTemporary()
            process.stderr.write(`[ErrorReporting] ❌ ${errorMsg}\n`)
            return
        }

        if (httpStatus === 401 || httpStatus === 403) {
            // Authentication/authorization error
            errorMsg = `Webhook authentication failed (HTTP ${httpStatus}) - check if webhook token is valid`
            disableErrorReportingTemporary()
            process.stderr.write(`[ErrorReporting] ❌ ${errorMsg}\n`)
            return
        }

        if (httpStatus && httpStatus >= 500) {
            // Server error - may be temporary, log but don't disable
            errorMsg = `Discord server error (HTTP ${httpStatus}) - will retry on next error`
            process.stderr.write(`[ErrorReporting] ⚠️ ${errorMsg}\n`)
            return
        }

        // Generic error message
        if (!errorMsg) {
            errorMsg = webhookError instanceof Error ? webhookError.message : String(webhookError)
        }

        // Log detailed error for debugging
        process.stderr.write(`[ErrorReporting] ❌ Failed to send error report: ${sanitizeSensitiveText(errorMsg)}\n`)

        // If it's a network error, provide additional context
        if (webhookError instanceof Error && (webhookError.message.includes('ENOTFOUND') || webhookError.message.includes('ECONNREFUSED'))) {
            process.stderr.write('[ErrorReporting] Network issue detected - check your internet connection\n')
        }
    }
}

/**
 * Get project version from package.json
 * FIXED: Use path.join to correctly resolve package.json location in both dev and production
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
