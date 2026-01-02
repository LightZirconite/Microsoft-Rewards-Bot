import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory rate limiting for error reporting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10

function isRateLimited(ip: string): boolean {
    const now = Date.now()
    const record = rateLimitMap.get(ip)

    if (!record || now > record.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
        return false
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
        return true
    }

    record.count++
    return false
}

// Vercel serverless handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }

    // Only POST allowed
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        // Rate limiting
        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
        if (isRateLimited(ip)) {
            return res.status(429).json({ error: 'Rate limit exceeded' })
        }

        // Check Discord webhook URL
        const webhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL
        if (!webhookUrl) {
            console.error('[ErrorReporting] DISCORD_ERROR_WEBHOOK_URL not configured')
            return res.status(503).json({ error: 'Error reporting service unavailable' })
        }

        // Validate payload
        const payload = req.body
        if (!payload?.error) {
            return res.status(400).json({ error: 'Invalid payload: missing error field' })
        }

        // Build Discord embed
        const embed = {
            title: '🔴 Bot Error Report',
            description: `\`\`\`\n${String(payload.error).slice(0, 1900)}\n\`\`\``,
            color: 0xdc143c,
            fields: [
                { name: 'Version', value: String(payload.context?.version || 'unknown'), inline: true },
                { name: 'Platform', value: String(payload.context?.platform || 'unknown'), inline: true },
                { name: 'Node', value: String(payload.context?.nodeVersion || 'unknown'), inline: true }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'Community Error Reporting' }
        }

        if (payload.stack) {
            const stackLines = String(payload.stack).split('\n').slice(0, 15).join('\n')
            embed.fields.push({
                name: 'Stack Trace',
                value: `\`\`\`\n${stackLines.slice(0, 1000)}\n\`\`\``,
                inline: false
            })
        }

        // Send to Discord
        const axios = (await import('axios')).default
        await axios.post(webhookUrl, {
            username: 'Microsoft Rewards Bot',
            avatar_url: 'https://raw.githubusercontent.com/LightZirconite/Microsoft-Rewards-Bot/refs/heads/main/assets/logo.png',
            embeds: [embed]
        }, { timeout: 10000 })

        console.log('[ErrorReporting] Report sent successfully')
        return res.json({ success: true, message: 'Error report received' })

    } catch (error) {
        console.error('[ErrorReporting] Failed:', error)
        return res.status(500).json({
            error: 'Failed to send error report',
            message: error instanceof Error ? error.message : 'Unknown error'
        })
    }
}
