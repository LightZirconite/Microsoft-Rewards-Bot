import { Request, Response, Router } from 'express'
import fs from 'fs'
import path from 'path'
import { AccountHistory } from '../util/state/AccountHistory'
import { getConfigPath, loadAccounts, loadConfig } from '../util/state/Load'
import { botController } from './BotController'
import { dashboardState } from './state'

export const apiRouter = Router()

// Initialize account history tracker (lazy loaded)
let accountHistoryInstance: AccountHistory | null = null

function getAccountHistory(): AccountHistory {
  if (!accountHistoryInstance) {
    const accounts = loadAccounts()
    accountHistoryInstance = new AccountHistory(accounts)
  }
  return accountHistoryInstance
}

// Helper to extract error message
const getErr = (e: unknown): string => e instanceof Error ? e.message : 'Unknown error'

// Helper to load accounts if not already loaded
function ensureAccountsLoaded(): void {
  const accounts = dashboardState.getAccounts()
  if (accounts.length === 0) {
    try {
      const loadedAccounts = loadAccounts()
      dashboardState.initializeAccounts(loadedAccounts.map(a => a.email))
    } catch {
      // Silently ignore: accounts loading is optional for API fallback
    }
  }
}

// GET /api/status - Bot status
apiRouter.get('/status', (_req: Request, res: Response) => {
  try {
    ensureAccountsLoaded()
    res.json(dashboardState.getStatus())
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/accounts - List all accounts with masked emails
apiRouter.get('/accounts', (_req: Request, res: Response) => {
  try {
    ensureAccountsLoaded()
    res.json(dashboardState.getAccounts())
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/logs - Recent logs
apiRouter.get('/logs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100
    const logs = dashboardState.getLogs(Math.min(limit, 500))
    res.json(logs)
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// DELETE /api/logs - Clear logs
apiRouter.delete('/logs', (_req: Request, res: Response) => {
  try {
    dashboardState.clearLogs()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/history - Recent run summaries
apiRouter.get('/history', (_req: Request, res: Response): void => {
  try {
    const reportsDir = path.join(process.cwd(), 'reports')
    if (!fs.existsSync(reportsDir)) {
      res.json([])
      return
    }

    const days = fs.readdirSync(reportsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, 7)
    const summaries: unknown[] = []

    for (const day of days) {
      const dayDir = path.join(reportsDir, day)
      const files = fs.readdirSync(dayDir).filter(f => f.startsWith('summary_') && f.endsWith('.json'))
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dayDir, file), 'utf-8')
          summaries.push(JSON.parse(content))
        } catch {
          continue
        }
      }
    }

    res.json(summaries.slice(0, 50))
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/config - Current config (tokens masked)
apiRouter.get('/config', (_req: Request, res: Response) => {
  try {
    const config = loadConfig()
    const safe = JSON.parse(JSON.stringify(config))

    // Mask sensitive data
    if (safe.webhook?.url) safe.webhook.url = maskUrl(safe.webhook.url)
    if (safe.conclusionWebhook?.url) safe.conclusionWebhook.url = maskUrl(safe.conclusionWebhook.url)
    if (safe.ntfy?.authToken) safe.ntfy.authToken = '***'

    res.json(safe)
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// POST /api/config - Update config (with backup)
apiRouter.post('/config', (req: Request, res: Response): void => {
  try {
    const newConfig = req.body
    const configPath = getConfigPath()

    if (!configPath || !fs.existsSync(configPath)) {
      res.status(404).json({ error: 'Config file not found' })
      return
    }

    // Backup current config
    const backupPath = `${configPath}.backup.${Date.now()}`
    fs.copyFileSync(configPath, backupPath)

    // Write new config
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8')

    res.json({ success: true, backup: backupPath })
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// POST /api/start - Start bot in background
apiRouter.post('/start', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = botController.getStatus()
    if (status.running) {
      sendError(res, 400, `Bot already running (PID: ${status.pid})`)
      return
    }

    const result = await botController.start()

    if (result.success) {
      sendSuccess(res, { message: 'Bot started successfully', pid: result.pid })
    } else {
      sendError(res, 500, result.error || 'Failed to start bot')
    }
  } catch (error) {
    sendError(res, 500, getErr(error))
  }
})

// POST /api/stop - Stop bot
apiRouter.post('/stop', (_req: Request, res: Response): void => {
  try {
    const result = botController.stop()

    if (result.success) {
      sendSuccess(res, { message: 'Bot stopped successfully' })
    } else {
      sendError(res, 400, result.error || 'Failed to stop bot')
    }
  } catch (error) {
    sendError(res, 500, getErr(error))
  }
})

// POST /api/restart - Restart bot
apiRouter.post('/restart', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await botController.restart()

    if (result.success) {
      sendSuccess(res, { message: 'Bot restarted successfully', pid: result.pid })
    } else {
      sendError(res, 500, result.error || 'Failed to restart bot')
    }
  } catch (error) {
    sendError(res, 500, getErr(error))
  }
})

// GET /api/metrics - Basic metrics
apiRouter.get('/metrics', (_req: Request, res: Response) => {
  try {
    const accounts = dashboardState.getAccounts()
    const totalPoints = accounts.reduce((sum, a) => sum + (a.points || 0), 0)
    const accountsWithErrors = accounts.filter(a => a.errors && a.errors.length > 0).length
    const avgPoints = accounts.length > 0 ? Math.round(totalPoints / accounts.length) : 0

    res.json({
      totalAccounts: accounts.length,
      totalPoints,
      avgPoints,
      accountsWithErrors,
      accountsRunning: accounts.filter(a => a.status === 'running').length,
      accountsCompleted: accounts.filter(a => a.status === 'completed').length,
      accountsIdle: accounts.filter(a => a.status === 'idle').length,
      accountsError: accounts.filter(a => a.status === 'error').length
    })
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/account/:email - Get specific account details
apiRouter.get('/account/:email', (req: Request, res: Response): void => {
  try {
    const { email } = req.params
    if (!email) {
      res.status(400).json({ error: 'Email parameter required' })
      return
    }

    const account = dashboardState.getAccount(email)

    if (!account) {
      res.status(404).json({ error: 'Account not found' })
      return
    }

    res.json(account)
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// POST /api/account/:email/reset - Reset account status
apiRouter.post('/account/:email/reset', (req: Request, res: Response): void => {
  try {
    const { email } = req.params
    if (!email) {
      res.status(400).json({ error: 'Email parameter required' })
      return
    }

    const account = dashboardState.getAccount(email)

    if (!account) {
      res.status(404).json({ error: 'Account not found' })
      return
    }

    dashboardState.updateAccount(email, {
      status: 'idle',
      errors: []
    })

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// POST /api/reset-state - Reset all job states for today
apiRouter.post('/reset-state', (_req: Request, res: Response): void => {
  try {
    const jobStatePath = path.join(process.cwd(), 'sessions', 'job-state')

    if (!fs.existsSync(jobStatePath)) {
      res.json({ success: true, message: 'No job state to reset' })
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    let resetCount = 0

    // Read all job state files and reset today's entries
    const files = fs.readdirSync(jobStatePath).filter(f => f.endsWith('.json'))

    for (const file of files) {
      try {
        const filePath = path.join(jobStatePath, file)
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

        // Reset today's completed activities
        if (content[today]) {
          delete content[today]
          fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8')
          resetCount++
        }
      } catch {
        // Continue processing other files if one fails
        continue
      }
    }

    // Reset account statuses in dashboard state
    const accounts = dashboardState.getAccounts()
    for (const account of accounts) {
      dashboardState.updateAccount(account.email, {
        status: 'idle',
        errors: []
      })
    }

    res.json({
      success: true,
      message: `Reset job state for ${resetCount} account(s)`,
      resetCount
    })
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/memory - Get current memory usage
apiRouter.get('/memory', (_req: Request, res: Response) => {
  try {
    const memUsage = process.memoryUsage()
    res.json({
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      formatted: {
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`,
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`
      }
    })
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/account-history - Get all account histories
apiRouter.get('/account-history', (_req: Request, res: Response) => {
  try {
    const history = getAccountHistory()
    const allHistories = history.getAllHistories()
    res.json(allHistories)
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/account-history/:email - Get specific account history
apiRouter.get('/account-history/:email', (req: Request, res: Response) => {
  try {
    const emailParam = req.params.email
    if (!emailParam) {
      res.status(400).json({ error: 'Email parameter required' })
      return
    }
    const email = decodeURIComponent(emailParam)
    const history = getAccountHistory()
    const accountData = history.getAccountHistory(email)
    res.json(accountData)
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// GET /api/account-stats/:email - Get account statistics
apiRouter.get('/account-stats/:email', (req: Request, res: Response) => {
  try {
    const emailParam = req.params.email
    if (!emailParam) {
      res.status(400).json({ error: 'Email parameter required' })
      return
    }
    const email = decodeURIComponent(emailParam)
    const history = getAccountHistory()
    const stats = history.getStats(email)
    res.json(stats)
  } catch (error) {
    res.status(500).json({ error: getErr(error) })
  }
})

// Helper to mask sensitive URLs
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const maskedHost = parsed.hostname.length > 6
      ? `${parsed.hostname.slice(0, 3)}***${parsed.hostname.slice(-3)}`
      : '***'
    const maskedPath = parsed.pathname.length > 5
      ? `${parsed.pathname.slice(0, 3)}***`
      : '***'
    return `${parsed.protocol}//${maskedHost}${maskedPath}`
  } catch {
    return '***'
  }
}

// Helper to send error response
function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message })
}

// Helper to send success response
function sendSuccess(res: Response, data: Record<string, unknown>): void {
  res.json({ success: true, ...data })
}
