// For using this, setup the following environment variables:
// SUPABASE_URL: Your Supabase project URL
// SUPABASE_SERVICE_ROLE_KEY: Your Supabase service role key
// DISCORD_ERROR_WEBHOOK_URL: The Discord webhook URL where errors will be sent
// AUTH_MASTER_SECRET: A secret string used to sign Bearer tokens for authorization

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
    // Private keys used to contact the Supabase infrastructure
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function isFirstError(errorId, normalized) {
    const { error } = await supabase
        .from('error_events')
        .insert({
            error_id: errorId,
            normalized_error: normalized
        })

    // In case the error already exists in the database
    if (error) {
        if (error.code === '23505') return false
        throw error
    }

    // Error doesn't exist, so we return true to anything that called the function
    return true
}

// Authorization verification
const MAX_CLOCK_SKEW = 30_000

function verifyAuthorization(auth) {
    // Verify if authorization is a Bearer token
    if (!auth || !auth.startsWith('Bearer ')) return false

    let decoded
    try {
        // Decode parts of the Bearer
        decoded = Buffer.from(auth.slice(7), 'base64').toString()
    } catch {
        return false
    }

    const [clientId, expStr, signature] = decoded.split('.')
    const exp = Number(expStr)

    if (!clientId || !exp || !signature) return false
    if (Date.now() > exp + MAX_CLOCK_SKEW) return false

    // Record the expected Bearer Authorization
    const expected = crypto
        .createHmac('sha256', process.env.AUTH_MASTER_SECRET)
        .update(`${clientId}.${exp}`)
        .digest('hex')

    try {
        return crypto.timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(signature)
        )
    } catch {
        return false
    }
}

// Ratelimit handler
// Used to avoid ratelimiting requests to the Discord API
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const rateLimitMap = new Map()

let globalCount = 0
let globalReset = Date.now() + 60_000
const GLOBAL_MAX = 30

// Get the IP used from the client to request Creamapi
function getIP(req) {
    return (
        req.headers['x-real-ip'] ||
        req.headers['x-forwarded-for']?.split(',')[0] ||
        req.socket?.remoteAddress ||
        'unknown' // In case of the ip could not be fetched
    )
}

// Function to check if the IP is ratelimited
function isRateLimited(ip) {
    const now = Date.now()
    const entry = rateLimitMap.get(ip)

    if (!entry || entry.reset < now) {
        rateLimitMap.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS })
        return false
    }

    return ++entry.count > RATE_LIMIT_MAX
}

// Function to handle a global ratelimit, for all users
function globalRateLimit() {
    const now = Date.now()
    if (now > globalReset) {
        globalReset = now + 60_000
        globalCount = 0
    }
    return ++globalCount > GLOBAL_MAX
}

// Utilities for Creamapi
const LIMITS = {
    desc: 1800,
    field: 900
}

// Sanitize every message sent to api, avoiding problems on discord server
function sanitize(text, max) {
    if (!text) return ''
    return String(text)
        .replace(/@(everyone|here)/gi, '@\u200b$1') // Remove @everyone from string
        .replace(/<@[!&]?\d+>/g, '@user') // Also, any mention will be removed
        .replace(/<#\d+>/g, '#channel')
        .slice(0, max) // Avoid long strings
}

// Function to make errors more generic to ErrorID
function normalizeError(text) {
    return text
        .replace(/\[[^\]]+]/g, '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'user')
        .replace(/\b[a-z0-9]{1,3}\*+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, 'user')
        .replace(/\b\d+\b/g, 'N')
        .replace(/[a-f0-9]{8,}/gi, 'hash')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase() // Replace capital letters
}

function generateErrorId(normalized) {
    return crypto
        .createHash('sha1')
        .update(normalized)
        .digest('hex')
        .slice(0, 10)
}

// Request handler
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') return res.end()
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    // Protected endpoint, verify Brearer Authorization
    if (!verifyAuthorization(req.headers.authorization)) {
        return res.status(401).json({ error: 'Unauthorized' })
    }

    if (isRateLimited(getIP(req)) || globalRateLimit()) {
        return res.status(429).json({ error: 'Rate limit exceeded' })
    }

    const webhook = process.env.DISCORD_ERROR_WEBHOOK_URL
    if (!webhook) {
        return res.status(503).json({ error: 'Webhook not configured' })
    }

    const { error, stack, context = {} } = req.body || {}
    if (typeof error !== 'string' || error.length < 5) {
        return res.status(400).json({ error: 'Invalid payload' })
    }

    const errorMsg = sanitize(error, LIMITS.desc)
    const stackMsg = sanitize(stack, LIMITS.field)

    const normalized = normalizeError(errorMsg)
    const errorId = generateErrorId(normalized)

    let firstOccurrence = false
    try {
        firstOccurrence = await isFirstError(errorId, normalized)
    } catch (e) {
        console.error('Supabase error:', e)
    }

    if (!firstOccurrence) {
        return res.json({ success: true, errorId, deduplicated: true })
    }

    const embed = {
        title: `🔴 Bot Error Report`,
        description: `\`\`\`\n${errorMsg}\n\`\`\``,
        color: 0xdc143c,
        fields: [
            // Information from the program
            { name: 'Error ID', value: `\`${errorId}\``, inline: true },
            { name: 'Platform', value: sanitize(context.platform, 50) || 'unknown', inline: true },
            { name: 'Version', value: sanitize(context.version, 50) || 'unknown', inline: true }
        ],
        // Timestamp, used to address errors by date-time
        timestamp: new Date().toISOString()
    }

    if (stackMsg) {
        embed.fields.push({
            name: 'Stack Trace',
            value: `\`\`\`\n${stackMsg}\n\`\`\``
        })
    }

    // Send the builded webhook message to Discord
    await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'Microsoft Rewards Bot - Error Reporter',
            // Include errorID outside the embed content for searching
            content: `-# ${errorId}`,
            embeds: [embed]
        })
    })

    // Return to the user that the error has been sent, and it's id
    return res.json({ success: true, errorId })
}