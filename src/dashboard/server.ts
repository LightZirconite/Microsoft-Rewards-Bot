import express from 'express'
import rateLimit from 'express-rate-limit'
import fs from 'fs'
import { createServer } from 'http'
import path from 'path'
import { WebSocket, WebSocketServer } from 'ws'
import { logEventEmitter } from '../util/notifications/Logger'
import { apiRouter } from './routes'
import { DashboardLog, dashboardState } from './state'

// Dashboard logging helper (uses events, NOT interception)
const dashLog = (message: string, type: 'log' | 'warn' | 'error' = 'log'): void => {
  const logEntry: DashboardLog = {
    timestamp: new Date().toISOString(),
    level: type,
    platform: 'MAIN',
    title: 'DASHBOARD',
    message
  }

  // Add to console
  console.log(`[${logEntry.timestamp}] [${logEntry.platform}] [${logEntry.title}] ${message}`)

  // Add to dashboard state
  dashboardState.addLog(logEntry)
}

const PORT = process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT) : 3000
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1'

export class DashboardServer {
  private app: express.Application
  private server: ReturnType<typeof createServer>
  private wss: WebSocketServer
  private clients: Set<WebSocket> = new Set()
  private heartbeatInterval?: NodeJS.Timeout
  private dashboardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs for dashboard UI
    standardHeaders: true,
    legacyHeaders: false,
  })
  private apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // reasonable cap for API interactions
    standardHeaders: true,
    legacyHeaders: false,
  })
  constructor() {
    this.app = express()
    this.server = createServer(this.app)
    this.wss = new WebSocketServer({ server: this.server })
    this.setupMiddleware()
    this.setupRoutes()
    this.setupWebSocket()
    this.setupLogEventListener() // FIXED: Use event listener instead of function interception
    this.setupStateListener()
  }

  private setupStateListener(): void {
    // Listen to dashboard state changes and broadcast to all clients
    dashboardState.addChangeListener((type, data) => {
      this.broadcastUpdate(type, data)
    })
  }

  private setupMiddleware(): void {
    this.app.use(express.json())

    // Disable caching for all static files
    this.app.use((req, res, next) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      res.set('Pragma', 'no-cache')
      res.set('Expires', '0')
      next()
    })

    this.app.use('/assets', express.static(path.join(__dirname, '../../assets'), {
      etag: false,
      maxAge: 0
    }))
    this.app.use(express.static(path.join(__dirname, '../../public'), {
      etag: false,
      maxAge: 0
    }))
  }

  private setupRoutes(): void {
    this.app.use('/api', this.apiLimiter, apiRouter)

    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() })
    })

    // Serve dashboard UI
    this.app.get('/', this.dashboardLimiter, (_req, res) => {
      const indexPath = path.join(__dirname, '../../public/index.html')

      // Force no cache on HTML files
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      res.set('Pragma', 'no-cache')
      res.set('Expires', '0')

      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath)
      } else {
        res.status(200).send(`
          <!DOCTYPE html>
          <html><head><title>Dashboard - API Only Mode</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Dashboard API Active</h1>
            <p>Frontend UI not found. API endpoints are available:</p>
            <ul style="list-style: none; padding: 0;">
              <li><a href="/api/status">GET /api/status</a></li>
              <li><a href="/api/accounts">GET /api/accounts</a></li>
              <li><a href="/api/logs">GET /api/logs</a></li>
              <li><a href="/api/metrics">GET /api/metrics</a></li>
              <li><a href="/health">GET /health</a></li>
            </ul>
          </body></html>
        `)
      }
    })
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const tracked = ws as WebSocket & { isAlive?: boolean }
      tracked.isAlive = true

      this.clients.add(tracked)
      dashLog('WebSocket client connected')

      tracked.on('pong', () => {
        tracked.isAlive = true
      })

      tracked.on('close', () => {
        this.clients.delete(tracked)
        dashLog('WebSocket client disconnected')
      })

      tracked.on('error', (error) => {
        dashLog(`WebSocket error: ${error instanceof Error ? error.message : String(error)}`, 'error')
      })

      // Send initial data on connect
      const recentLogs = dashboardState.getLogs(100)
      const status = dashboardState.getStatus()
      const accounts = dashboardState.getAccounts()

      tracked.send(JSON.stringify({
        type: 'init',
        data: {
          logs: recentLogs,
          status,
          accounts
        }
      }))
    })

    // Heartbeat to drop dead connections and keep memory clean
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        const tracked = client as WebSocket & { isAlive?: boolean }
        if (tracked.isAlive === false) {
          tracked.terminate()
          this.clients.delete(tracked)
          continue
        }
        tracked.isAlive = false
        try {
          tracked.ping()
        } catch (error) {
          dashLog(`WebSocket ping error: ${error instanceof Error ? error.message : String(error)}`, 'error')
          tracked.terminate()
          this.clients.delete(tracked)
        }
      }
    }, 30000)
  }

  /**
   * FIXED: Listen to log events instead of intercepting Logger.log function
   * This prevents WebSocket disconnection issues and function interception conflicts
   */
  private setupLogEventListener(): void {
    logEventEmitter.on('log', (logEntry: DashboardLog) => {
      // Add to dashboard state and broadcast
      dashboardState.addLog(logEntry)
      this.broadcastUpdate('log', { log: logEntry })
    })

    dashLog('Log event listener active')
  }

  public broadcastUpdate(type: string, data: unknown): void {
    const payload = JSON.stringify({ type, data })
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch (error) {
          dashLog(`Error broadcasting update: ${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
    }
  }

  public start(): void {
    this.server.listen(PORT, HOST, () => {
      dashLog(`Server running on http://${HOST}:${PORT}`)
      dashLog('WebSocket ready for live logs')
    })
  }

  public stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
    this.wss.close()
    this.server.close()
    dashLog('Server stopped')
  }
}

export function startDashboardServer(): DashboardServer {
  const server = new DashboardServer()
  server.start()
  return server
}
