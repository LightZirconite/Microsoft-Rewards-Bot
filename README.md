# Microsoft Rewards Bot

<p align="center">
	<img src="assets/logo.png" alt="Microsoft Rewards Bot logo" width="180" />
</p>

<p align="center">
	<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-≥20-brightgreen?style=flat-square&logo=nodedotjs" alt="Node.js 20+" /></a>
	<a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript" alt="TypeScript" /></a>
	<a href="https://discord.gg/k5uHkx9mne"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
	<a href="https://github.com/LightZirconite/Microsoft-Rewards-Bot/stargazers"><img src="https://img.shields.io/github/stars/LightZirconite/Microsoft-Rewards-Bot?style=flat-square&color=gold" alt="Stars" /></a>
</p>

<p align="center">
	Advanced Microsoft Rewards automation with human-like behavior.<br />
	Anti-detection · Multi-account · Dashboard · Scheduling
</p>

---

## ⚡ Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/LightZirconite/Microsoft-Rewards-Bot.git
cd Microsoft-Rewards-Bot

# 2. Setup accounts
cp src/accounts.example.jsonc src/accounts.jsonc
# Edit src/accounts.jsonc with your Microsoft account(s)

# 3. Run
npm start
```

## Features

| Feature | Description |
|---------|-------------|
| 🤖 **Full Automation** | Daily Set, More Promotions, Punch Cards, Read to Earn, Daily Check-in |
| 🔍 **Smart Searches** | Desktop & Mobile with diverse query sources (Google Trends, Reddit) |
| 🛡️ **Anti-Detection** | Advanced fingerprinting, humanized delays, natural mouse movements |
| 📊 **Web Dashboard** | Real-time monitoring panel for all accounts |
| ⏰ **Built-in Scheduler** | Run automatically at specified times with jitter |
| 📱 **Multi-Account** | Process multiple accounts in parallel clusters |
| 🐳 **Docker Ready** | Production-ready containerization |
| 🔔 **Notifications** | Discord webhooks, NTFY push notifications |
| 🛠️ **Account Creator** | Automated Microsoft account registration |
| 💾 **Job State** | Resume-on-crash, skip completed accounts |

<img width="1147" height="1082" alt="image" src="https://github.com/user-attachments/assets/e337cad6-dc8d-40eb-8b08-53da5545b209" />


## Documentation

📚 **[Full Documentation](docs/index.md)** — Setup guides, configuration, scheduling, troubleshooting.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Build and run the bot |
| `npm run dashboard` | Start web monitoring panel |
| `npm run creator` | Account creation wizard |
| `npm run dev` | Development mode with hot reload |
| `npm run docker:compose` | Run in Docker container |

## Account Creation Warning

⚠️ New accounts may be flagged if they earn points immediately. Let fresh accounts age 2-4 weeks before using them.

---

## 🔥 Why Choose This Fork?

This is an enhanced fork of [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) with additional features:

| Feature | This Fork | Original |
|---------|:---------:|:--------:|
| **Web Dashboard** | ✅ Real-time monitoring UI | ❌ |
| **Built-in Scheduler** | ✅ Internal with jitter | ❌ External cron only |
| **Account Creator** | ✅ Automated registration | ❌ |
| **Job State** | ✅ Resume-on-crash | ❌ |
| **Error Reporting** | ✅ Auto community reports | ❌ |
| **Vacation Mode** | ✅ Random off-days | ❌ |
| **Risk Management** | ✅ Adaptive throttling | ❌ |
| **Compromised Recovery** | ✅ Security prompt handling | ❌ |
| **Multi-Pass Runs** | ✅ Configurable | ❌ |
| **Query Sources** | Google Trends, Reddit, News | Google Trends |
| **Documentation** | ✅ Comprehensive | ⚠️ TODO |

Both projects share: Discord/NTFY webhooks, fingerprinting, Docker support, multi-account, Daily Set/Promotions/Searches.

### Migration

```bash
# accounts.jsonc format is compatible
cp your-old-accounts.jsonc src/accounts.jsonc
```

---

## Disclaimer

> ⚠️ **Use at your own risk.** Automation of Microsoft Rewards may lead to account suspension. This software is for educational purposes only. The authors are not responsible for any actions taken by Microsoft.

---

<p align="center">
	<a href="https://discord.gg/k5uHkx9mne">Discord</a> · 
	<a href="docs/index.md">Documentation</a> · 
	<a href="https://discord.gg/k5uHkx9mne">Report Bug</a>
</p>
