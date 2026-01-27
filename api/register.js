export const config = { runtime: 'nodejs' }

// Crypto module for generating Authorization tokens for API calls
const crypto = require('crypto')

const TOKEN_TTL_MS = 60 * 180_000 // 3 hour valid token 

module.exports = function register(req, res) {
    // Universal cors headers for any app/website
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    // Derivate Authorization from Master secret
    const master = process.env.AUTH_MASTER_SECRET
    
    if (!master) {
        return res.status(500).json({ error: 'Master secret not configured' })
    }

    const clientId = crypto.randomBytes(8).toString('hex')
    const exp = Date.now() + TOKEN_TTL_MS

    const payload = `${clientId}.${exp}`

    const signature = crypto
        .createHmac('sha256', master)
        .update(payload)
        .digest('hex')

    const token = Buffer
        .from(`${payload}.${signature}`)
        .toString('base64url') // better than normal base64

    // Return the Authorization derivated from Master secret + machineId
    return res.json({
        authorization: `Bearer ${token}`,
        expiresAt: exp
    })
}