# Copilot Instructions - Microsoft Rewards Bot

## Project Architecture

### Core Structure
```
src/
├── index.ts                 # Main entry point, bot orchestration
├── constants.ts             # Global constants and configurations
├── account-creation/        # Automated account creation system
├── browser/                 # Browser automation (Playwright)
├── dashboard/               # Web dashboard (Express + WebSockets)
├── flows/                   # Desktop/Mobile automation flows
├── functions/               # Core features (Login, Activities, Workers)
├── interface/               # TypeScript interfaces and types
├── scheduler/               # Task scheduling system
└── util/                    # Utility modules
    ├── browser/             # Browser utilities (UA, Humanizer)
    ├── core/                # Core utilities (Utils, MemoryMonitor)
    ├── network/             # HTTP clients, query engines
    ├── notifications/       # Discord, NTFY notifications
    ├── security/            # Anti-detection, ban detection
    ├── state/               # State management (JobState, Load)
    └── validation/          # Input validation, startup checks
```

### Key Design Patterns

#### 1. **Bot Class Pattern** (`index.ts`)
- Main orchestrator with dependency injection
- Manages lifecycle: initialize → run → cleanup
- Supports cluster mode (multi-account parallel processing)
- Implements crash recovery and graceful shutdown

#### 2. **Flow Pattern** (`flows/`)
- **DesktopFlow**: Desktop browser automation
- **MobileFlow**: Mobile browser automation  
- **SummaryReporter**: Centralized reporting system
- Each flow is self-contained with error handling

#### 3. **Activity Handler Pattern** (`functions/activities/`)
- Each activity (Quiz, Poll, Search, etc.) is a separate class
- Implements error recovery and retry logic
- Uses human-like delays and behaviors

#### 4. **State Management** (`util/state/`)
- **JobState**: Persistent task completion tracking
- **AccountHistory**: Historical data storage
- **Load**: Configuration and account loading
- Files use `.jsonc` format (JSON with comments)

#### 5. **Dashboard Architecture** (`dashboard/`)
- **Server**: Express server with WebSockets
- **BotController**: Bot lifecycle management for dashboard
- **StatsManager**: Persistent statistics tracking
- **State**: In-memory state management
- Real-time updates via WebSocket broadcast

---

## Critical Implementation Rules

### 1. **Configuration Files**

**IMPORTANT**: Files use `.example.jsonc` templates:
- `src/config.example.jsonc` → `src/config.jsonc`
- `src/accounts.example.jsonc` → `src/accounts.jsonc`
- Auto-copied on first run by `FileBootstrap.ts`

**Loading Order**:
```typescript
// 1. Check multiple locations
const candidates = [
  'src/config.jsonc',
  'config.jsonc',
  'src/config.json'  // Legacy support
]

// 2. Strip JSON comments
const text = stripJsonComments(rawContent)

// 3. Normalize schema (flat + nested support)
const config = normalizeConfig(JSON.parse(text))
```

### 2. **Browser Automation**

**Always use these utilities**:
```typescript
// Humanized typing
await this.browser.utils.humanType(page, selector, text)

// Smart waits (handles stale elements)
await this.browser.utils.smartWait(page, selector, { timeout: 30000 })

// Random gestures (anti-detection)
await this.humanizer.randomGesture(page)
```

**NEVER**:
- Direct `page.type()` or `page.fill()`
- Fixed delays (`await page.waitForTimeout(5000)`)
- Hardcoded selectors without fallback

### 3. **Error Handling**

**Pattern to follow**:
```typescript
try {
  // Attempt operation
  await riskyOperation()
} catch (error) {
  // 1. Detect ban/security
  const ban = detectBanReason(error)
  if (ban.status) {
    await this.engageGlobalStandby(ban.reason, email)
    throw error
  }
  
  // 2. Log with context
  log(this.isMobile, 'MODULE', `Failed: ${getErrorMessage(error)}`, 'error')
  
  // 3. Retry or fail gracefully
  if (retryCount < MAX_RETRIES) {
    await this.utils.wait(BACKOFF_MS)
    return await retryOperation()
  }
  
  throw error
}
```

### 4. **Logging System**

**Use centralized logger**:
```typescript
import { log } from '../util/notifications/Logger'

// Format: log(isMobile, source, message, level, color)
log(false, 'SEARCH', 'Starting desktop searches', 'log', 'cyan')
log(true, 'QUIZ', 'Quiz failed: timeout', 'error', 'red')
```

**Levels**: `'log' | 'warn' | 'error'`  
**Colors**: `'cyan' | 'yellow' | 'red' | 'green'`

### 5. **State Persistence**

**Always use JobState for idempotency**:
```typescript
// Check if already done
if (this.accountJobState.isCompleted(email, activityKey)) {
  log(mobile, 'ACTIVITY', `${activityKey} already completed`, 'warn')
  return
}

// Mark as completed after success
this.accountJobState.markCompleted(email, activityKey)
```

**Activity Keys**:
- `desktop-search`, `mobile-search`
- `daily-set`, `more-promotions`, `punch-cards`
- `read-to-earn`, `daily-check-in`

### 6. **Dashboard Integration**

**Update dashboard state**:
```typescript
import { dashboardState } from '../dashboard/state'

// Update account status
dashboardState.updateAccount(email, {
  status: 'running', // 'idle' | 'running' | 'completed' | 'error'
  errors: []
})

// Add logs
dashboardState.addLog({
  timestamp: new Date().toISOString(),
  level: 'log',
  platform: 'DESKTOP',
  title: 'SEARCH',
  message: 'Completed 30 searches'
})
```

### 7. **Anti-Detection**

**Mandatory humanization**:
```typescript
// Random delays between actions
await this.humanizer.randomDelay('search') // 2-5 seconds

// Mouse movements
await this.humanizer.randomGesture(page)

// Scroll simulation
await this.browser.utils.scrollRandomAmount(page)

// Click with human-like coordinates
await this.browser.utils.humanClick(page, selector)
```

**CRITICAL**: Never disable humanization in production!

---

## Common Tasks

### Adding a New Activity

1. **Create activity class**:
```typescript
// src/functions/activities/NewActivity.ts
import { ActivityHandler } from '../../interface/ActivityHandler'

export class NewActivity extends ActivityHandler {
  async execute(): Promise<void> {
    const activityKey = 'new-activity'
    
    // Check if already done
    if (this.bot.accountJobState.isCompleted(this.bot.currentAccountEmail!, activityKey)) {
      return
    }
    
    // Execute activity
    await this.performActivity()
    
    // Mark complete
    this.bot.accountJobState.markCompleted(this.bot.currentAccountEmail!, activityKey)
  }
  
  private async performActivity(): Promise<void> {
    // Implementation
  }
}
```

2. **Register in Workers.ts**:
```typescript
if (this.bot.config.workers.doNewActivity) {
  await this.runActivity('NewActivity', async () => {
    const activity = new NewActivity(this.bot)
    await activity.execute()
  })
}
```

3. **Add config option**:
```typescript
// interface/Config.ts
export interface ConfigWorkers {
  doNewActivity: boolean
  // ... other activities
}
```

### Adding a Dashboard API Endpoint

```typescript
// src/dashboard/routes.ts
apiRouter.get('/api/new-endpoint', async (req: Request, res: Response) => {
  try {
    // Validate input
    const param = req.query.param as string
    if (!param) {
      return sendError(res, 400, 'Missing param')
    }
    
    // Process
    const result = await processData(param)
    
    // Respond
    res.json({ success: true, data: result })
  } catch (error) {
    sendError(res, 500, getErr(error))
  }
})
```

### Debugging

**Enable verbose logging**:
```bash
# Full debug output
DEBUG_REWARDS_VERBOSE=1 npm start

# Specific module debug
DEBUG=playwright:* npm start
```

**Common debug points**:
- Browser: `this.browser.func.makeDebugScreenshot(page, 'issue-name')`
- State: `console.log(this.accountJobState.getState(email))`
- Network: `await this.axios.request(config)` (auto-logged)

---

## Testing Checklist

Before committing changes:
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes (or `npm run lint:fix`)
- [ ] Test with `npm start` (single account)
- [ ] Test dashboard with `npm run dashboard`
- [ ] Check JobState resume works (stop mid-run, restart)
- [ ] Verify humanization delays are active
- [ ] Test error handling (disconnect network mid-run)
- [ ] Check logs are informative and properly formatted

---

## File Naming Conventions

- **Interfaces**: PascalCase (`Account.ts`, `Config.ts`)
- **Classes**: PascalCase (`BrowserFunc.ts`, `StatsManager.ts`)
- **Utilities**: PascalCase (`Utils.ts`, `Logger.ts`)
- **Constants**: SCREAMING_SNAKE_CASE in `constants.ts`
- **Config files**: kebab-case + .jsonc extension

---

## Prohibited Patterns

❌ **DO NOT**:
- Hardcode credentials or sensitive data
- Use `any` type (use `unknown` + type guards)
- Directly manipulate `dist/` (auto-generated from `src/`)
- Create `.json` configs (use `.jsonc` with comments)
- Ignore TypeScript errors (fix properly)
- Use `console.log()` directly (use `log()` function)
- Block main thread with `while(true)` loops
- Store passwords in plaintext outside `accounts.jsonc`

✅ **DO**:
- Use strict TypeScript checks
- Add JSDoc comments for public APIs
- Handle all promise rejections
- Use `try/finally` for cleanup
- Validate external input
- Use environment variables for secrets when possible
- Test on Windows + Linux (cross-platform compatible)

---

## Key Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `rebrowser-playwright` | Browser automation | Patched for detection evasion |
| `fingerprint-generator` | Browser fingerprinting | Generates realistic fingerprints |
| `express` | Dashboard server | RESTful API + WebSockets |
| `axios` | HTTP client | Used for Rewards API calls |
| `cheerio` | HTML parsing | Extracting activity data |
| `chalk` | Terminal colors | Pretty console output |

---

## Update Process

1. **GitHub releases**: Bot auto-updates from GitHub
2. **Config updates**: Use `autoUpdateConfig: false` to preserve customizations
3. **Accounts updates**: Use `autoUpdateAccounts: false` to preserve credentials
4. **Smart merge**: Compares local vs remote, only updates if unchanged

**See**: `scripts/installer/update.mjs` for implementation

---

## Performance Guidelines

- **Memory**: Target < 500MB per account (monitor with `MemoryMonitor.ts`)
- **Execution time**: ~5-10 minutes per account (desktop + mobile)
- **Concurrent accounts**: Default 1 cluster, max 4 recommended
- **Rate limiting**: Respect Bing search delays (3-5 min default)

---

## Support & Community

- **GitHub Issues**: Bug reports and feature requests
- **Discord**: Real-time community support
- **Docs**: `docs/` folder contains detailed guides

---

**Last Updated**: January 2026  
**Maintainer**: LightZirconite
