<p align="center">
  <img src="assets/logo.png" alt="Microsoft Rewards Bot" width="200">
</p>

<h1 align="center">Microsoft Rewards Bot</h1>

<p align="center">
  <strong>Automated Microsoft Rewards point collector — V4</strong><br>
  Built for the <b>new</b> Microsoft Rewards dashboard
</p>

<p align="center">
  <a href="https://discord.gg/k5uHkx9mne"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <img src="https://img.shields.io/badge/Version-4.0.0-blue?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Node.js-v25.x-green?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-Proprietary_(Phase_1)-red?style=for-the-badge" alt="License">
</p>

> [!IMPORTANT]
> **V4** supports **only** the new Microsoft Rewards dashboard.
> If you are still on the legacy dashboard, use the free [V3 (open-source)](https://github.com/LightZirconite/Microsoft-Rewards-Bot) instead.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Setup](#quick-setup)
- [Docker Setup](#docker-setup)
- [Configuration](#configuration)
- [Account Setup](#account-setup)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Features

<details>
<summary><strong>🔍 Bing Searches</strong></summary>

- Desktop & mobile search automation
- Parallel searching for faster completion
- Multiple query engines (Google, Wikipedia, Reddit, local)
- Configurable delays and timing for human-like behavior
- Random result scrolling & clicking
- Read-to-Earn article completion

</details>

<details>
<summary><strong>📋 Daily Activities</strong></summary>

- Daily Set completion (quizzes, polls, links)
- Special & promotional offers
- Daily check-in streak
- Daily streak tracking & protection
- Punch cards / quest modals

</details>

<details>
<summary><strong>🎁 Rewards Management</strong></summary>

- Automatic point claiming
- Redeem goal configuration (auto-redeem or manual)
- Dashboard info extraction (points, level, streaks)
- Phone verification detection (graceful skip)

</details>

<details>
<summary><strong>📱 App Promotions</strong></summary>

- App reward completion
- Find Clippy challenges
- Double search point bonuses
- URL reward activities

</details>

<details>
<summary><strong>🛡️ Anti-Detection</strong></summary>

- Browser fingerprint generation & injection
- Fingerprint persistence (desktop & mobile)
- Ghost cursor (human-like mouse movements)
- Patchright browser (Playwright anti-detection fork)
- Per-account proxy support (HTTP, HTTPS, SOCKS)

</details>

<details>
<summary><strong>👥 Multi-Account</strong></summary>

- Unlimited accounts support
- Concurrent cluster execution
- Per-account geo-locale & language settings
- Per-account proxy configuration
- TOTP / 2FA automatic code entry
- Recovery email support

</details>

<details>
<summary><strong>🐳 Docker</strong></summary>

- Single-command deployment
- Cron-based scheduling
- Run-on-start option
- Random sleep delay to avoid detection patterns
- Stuck process timeout protection
- Health checks

</details>

<details>
<summary><strong>🔔 Notifications</strong></summary>

- Discord webhook integration
- Ntfy push notifications
- Configurable log filtering (whitelist / blacklist)
- Keyword & regex-based notification rules

</details>

<details>
<summary><strong>🆕 V4 — New Dashboard Support</strong></summary>

- Full support for the new Next.js + React Aria dashboard
- Centralized CSS selector registry (language-agnostic)
- Cookie consent banner auto-handling
- Disclosure/collapsible section navigation
- Hero card interactions (profile, points, claims)
- Bing search URL attribution tracking
- Streak bonus & progress bar detection

</details>

---

## Requirements

| Requirement             | Version    | Notes                                                                  |
| ----------------------- | ---------- | ---------------------------------------------------------------------- |
| **Node.js**             | v25.x      | [Download here](https://nodejs.org/) — **must match bytecode version** |
| **Git**                 | Any recent | [Download here](https://git-scm.com/)                                  |
| **Docker** _(optional)_ | Any recent | Only needed for Docker deployment                                      |

**Supported platforms:** Windows, Linux, macOS, WSL, Docker.

> [!IMPORTANT]
> This release ships pre-compiled V8 bytecode. You **must** use Node.js **v25.x** (any minor/patch).
> Other major versions (v24, v26, etc.) will fail with a startup error.

---

## Quick Setup

### 1. Download or clone

```bash
git clone --branch release https://github.com/LightZirconite/Microsoft-Rewards-Bot.git
cd Microsoft-Rewards-Bot
```

Or download the latest release from [Releases](https://github.com/LightZirconite/Microsoft-Rewards-Bot/releases).

### 2. Install dependencies

```bash
npm install
npx patchright install chromium
```

### 3. Configure your accounts

```bash
cp dist/accounts.example.json dist/accounts.json
cp dist/config.example.json dist/config.json
```

Edit `dist/accounts.json` with your Microsoft account credentials.
Edit `dist/config.json` with your preferences (see [Configuration](#configuration)).

> [!CAUTION]
> Do not skip this step. The bot will not start without valid configuration files.

### 4. Run

```bash
npm start
```

That's it! The bot will log in and start completing your Microsoft Rewards tasks.

---

## Docker Setup

### 1. Configure

```bash
cp dist/accounts.example.json dist/accounts.json
cp dist/config.example.json dist/config.json
```

Edit both files. Make sure `headless` is set to `true` in `dist/config.json`.

### 2. Run

```bash
docker compose up -d
```

> [!TIP]
> Monitor logs with `docker logs microsoft-rewards-bot`.

### Docker Environment Variables

| Variable            | Default           | Description                        |
| ------------------- | ----------------- | ---------------------------------- |
| `TZ`                | `America/Toronto` | Container timezone                 |
| `CRON_SCHEDULE`     | `0 7 * * *`       | When to run (cron format)          |
| `RUN_ON_START`      | `true`            | Run immediately on container start |
| `SKIP_RANDOM_SLEEP` | `false`           | Skip random startup delay          |

---

## Configuration

Edit `dist/config.json` to customize behavior.

<details>
<summary><strong>Core Settings</strong></summary>

| Setting                    | Type    | Default                      | Description                                 |
| -------------------------- | ------- | ---------------------------- | ------------------------------------------- |
| `baseURL`                  | string  | `"https://rewards.bing.com"` | Microsoft Rewards base URL                  |
| `sessionPath`              | string  | `"sessions"`                 | Directory to store browser sessions         |
| `headless`                 | boolean | `false`                      | Run browser invisibly (required for Docker) |
| `runOnZeroPoints`          | boolean | `false`                      | Run even when no points are available       |
| `clusters`                 | number  | `1`                          | Number of concurrent account clusters       |
| `errorDiagnostics`         | boolean | `false`                      | Enable error diagnostics                    |
| `searchOnBingLocalQueries` | boolean | `false`                      | Use local query list                        |
| `globalTimeout`            | string  | `"30sec"`                    | Timeout for all actions                     |

</details>

<details>
<summary><strong>Workers</strong></summary>

| Setting                       | Type    | Default | Description                  |
| ----------------------------- | ------- | ------- | ---------------------------- |
| `workers.doDailySet`          | boolean | `true`  | Complete daily set           |
| `workers.doSpecialPromotions` | boolean | `true`  | Complete special promotions  |
| `workers.doMorePromotions`    | boolean | `true`  | Complete more promotions     |
| `workers.doAppPromotions`     | boolean | `true`  | Complete app promotions      |
| `workers.doDesktopSearch`     | boolean | `true`  | Perform desktop searches     |
| `workers.doMobileSearch`      | boolean | `true`  | Perform mobile searches      |
| `workers.doDailyCheckIn`      | boolean | `true`  | Complete daily check-in      |
| `workers.doReadToEarn`        | boolean | `true`  | Complete Read-to-Earn        |
| `workers.doDailyStreak`       | boolean | `true`  | Track daily streak           |
| `workers.doRedeemGoal`        | boolean | `true`  | Auto-redeem goal management  |
| `workers.doDashboardInfo`     | boolean | `true`  | Extract dashboard statistics |
| `workers.doClaimPoints`       | boolean | `true`  | Claim available points       |

</details>

<details>
<summary><strong>Search Settings</strong></summary>

| Setting                                | Type     | Default                                      | Description                         |
| -------------------------------------- | -------- | -------------------------------------------- | ----------------------------------- |
| `searchSettings.scrollRandomResults`   | boolean  | `false`                                      | Scroll randomly on results          |
| `searchSettings.clickRandomResults`    | boolean  | `false`                                      | Click random links                  |
| `searchSettings.parallelSearching`     | boolean  | `true`                                       | Run searches in parallel            |
| `searchSettings.queryEngines`          | string[] | `["google", "wikipedia", "reddit", "local"]` | Query engines to use                |
| `searchSettings.searchResultVisitTime` | string   | `"10sec"`                                    | Time to spend on each search result |
| `searchSettings.searchDelay.min`       | string   | `"30sec"`                                    | Min delay between searches          |
| `searchSettings.searchDelay.max`       | string   | `"1min"`                                     | Max delay between searches          |

</details>

<details>
<summary><strong>Logging</strong></summary>

| Setting                     | Type     | Default                | Description                       |
| --------------------------- | -------- | ---------------------- | --------------------------------- |
| `debugLogs`                 | boolean  | `false`                | Enable debug logging              |
| `consoleLogFilter.enabled`  | boolean  | `false`                | Enable console log filtering      |
| `consoleLogFilter.mode`     | string   | `"whitelist"`          | Filter mode (whitelist/blacklist) |
| `consoleLogFilter.levels`   | string[] | `["error", "warn"]`    | Log levels to filter              |
| `consoleLogFilter.keywords` | string[] | `["starting account"]` | Keywords to filter                |

</details>

<details>
<summary><strong>Proxy</strong></summary>

| Setting             | Type    | Default | Description                 |
| ------------------- | ------- | ------- | --------------------------- |
| `proxy.queryEngine` | boolean | `true`  | Proxy query engine requests |

Per-account proxy configuration is set in `accounts.json`.

</details>

<details>
<summary><strong>Webhooks</strong></summary>

| Setting                   | Type    | Default                   | Description               |
| ------------------------- | ------- | ------------------------- | ------------------------- |
| `webhook.discord.enabled` | boolean | `false`                   | Enable Discord webhook    |
| `webhook.discord.url`     | string  | `""`                      | Discord webhook URL       |
| `webhook.ntfy.enabled`    | boolean | `false`                   | Enable ntfy notifications |
| `webhook.ntfy.url`        | string  | `""`                      | ntfy server URL           |
| `webhook.ntfy.topic`      | string  | `""`                      | ntfy topic                |
| `webhook.ntfy.token`      | string  | `""`                      | ntfy authentication token |
| `webhook.ntfy.title`      | string  | `"Microsoft-Rewards-Bot"` | Notification title        |
| `webhook.ntfy.priority`   | number  | `3`                       | Priority (1-5)            |

> [!WARNING]
> **Ntfy users**: enable `webhookLogFilter` or you will receive push notifications for _all_ logs.

</details>

<details>
<summary><strong>Redeem Goal</strong></summary>

| Setting                     | Type    | Default  | Description             |
| --------------------------- | ------- | -------- | ----------------------- |
| `redeemGoal.enabled`        | boolean | `false`  | Enable auto-redeem goal |
| `redeemGoal.skuUrl`         | string  | `""`     | SKU page URL            |
| `redeemGoal.skuOptionValue` | string  | `""`     | SKU option value        |
| `redeemGoal.redeemMode`     | string  | `"auto"` | `"auto"` or `"manual"`  |

</details>

---

## Account Setup

Edit `dist/accounts.json`. The file is a **flat array** of account objects.

```json
[
    {
        "email": "your-email@example.com",
        "password": "your-password",
        "totpSecret": "",
        "recoveryEmail": "",
        "geoLocale": "auto",
        "langCode": "en",
        "proxy": {
            "proxyAxios": false,
            "url": "",
            "port": 0,
            "username": "",
            "password": ""
        },
        "saveFingerprint": {
            "mobile": false,
            "desktop": false
        }
    }
]
```

> [!TIP]
> **2FA Setup:** Go to [Microsoft Security settings](https://account.microsoft.com/security) → Manage how you sign in → Add Authenticator app → Select "Enter code manually". Use that code as `totpSecret`.

---

## Updating

When a new version is released:

1. Download the new release (or `git pull` if using git)
2. **Verify your Node.js version** matches the required major version (see Requirements)
3. Run `npm install` to update dependencies
4. Your `accounts.json` and `config.json` are **preserved** — no need to reconfigure
5. Run `npm start`

> [!NOTE]
> Check the release notes for any breaking changes that may require config updates.

---

## Troubleshooting

> [!TIP]
> Most login issues can be fixed by deleting the `sessions/` folder and rerunning the script.

| Issue                  | Solution                                                     |
| ---------------------- | ------------------------------------------------------------ |
| Login fails            | Delete `sessions/` folder and retry                          |
| Points not earned      | Check if Rewards is available in your region                 |
| Docker headless issues | Ensure `headless: true` in `config.json`                     |
| 2FA prompt             | Add `totpSecret` to your account config                      |
| Proxy errors           | Verify proxy credentials and connectivity                    |
| `Cannot find module`   | Run `npm install` again                                      |
| Browser not found      | Run `npx patchright install chromium`                        |
| Bytecode version error | Install the correct Node.js major version (see Requirements) |

---

## License

This software is **proprietary**. See [LICENSE](LICENSE) for full terms.

- Source code is protected — redistribution, decompilation, and reverse engineering are prohibited
- A valid license key is required for operation
- Personal use is permitted under the terms of the license agreement

---

## Disclaimer

> Use at your own risk. Automation of Microsoft Rewards may lead to account suspension or bans.
> This software is provided as-is with no warranty.
> The authors are not responsible for any actions taken by Microsoft against your account(s).

<p align="center">
  <sub>Made by <a href="https://github.com/LightZirconite">LightZirconite</a></sub>
</p>
