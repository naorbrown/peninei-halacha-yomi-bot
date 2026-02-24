<p align="center">
  <strong>@PenineiHalachaYomi Bot</strong>
</p>

<p align="center">
  A Telegram bot that delivers two daily <a href="https://ph.yhb.org.il/pninayomit/">Peninei Halacha</a> voice recordings every morning at 05:00 Israel time.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-blue?logo=docker">
  <img alt="Tests" src="https://img.shields.io/badge/tests-vitest-yellow?logo=vitest">
</p>

---

## Overview

**Peninei Halacha Yomi Bot** automatically scrapes the daily halachot (Jewish legal teachings) from [ph.yhb.org.il](https://ph.yhb.org.il/pninayomit/) and delivers them as audio messages to Telegram subscribers. Each morning, subscribers receive two voice recordings covering that day's halachot from the *Peninei Halacha* series by Rav Eliezer Melamed.

## Features

- **Daily delivery** — Two halachot sent automatically at 05:00 Israel time (DST-aware)
- **Audio + text** — Voice recordings with linked titles; graceful text fallback if audio is unavailable
- **Subscriber management** — Subscribe/unsubscribe via Telegram commands
- **Admin controls** — Manual broadcast trigger and startup/status notifications
- **Resilient broadcasting** — Rate-limit backoff, blocked-user cleanup, per-message error isolation
- **Deduplication** — Sentinel cache + broadcast state prevents double-sends across DST transitions
- **Security hardened** — URL allowlist validation, input escaping, request timeouts
- **GitHub Actions broadcasts** — Daily broadcasts run serverlessly via GitHub Actions (no server required)
- **Docker-ready** — Optional Docker deployment for interactive bot commands

## Architecture

```
                    GitHub Actions (daily-broadcast.yml)
                    ┌──────────────────────────────────┐
                    │  scripts/broadcast.js             │
                    │  - Scrapes daily halachot         │
  ┌──────────┐     │  - Broadcasts to all subscribers   │     ┌───────────────┐
  │ Telegram │◄────│  - Updates .github/state/          │────►│ ph.yhb.org.il │
  │  Users   │     └──────────────────────────────────┘     │  (scraper)    │
  │          │                                               └───────────────┘
  │          │     Docker / VPS (optional)
  │          │     ┌──────────────────────────────────┐
  │          │◄────│  src/index.js                     │
  │          │     │  - /start, /stop, /today commands │     ┌───────────────┐
  └──────────┘     │  - Interactive bot (polling)      │────►│ .github/state │
                    └──────────────────────────────────┘     │  JSON files   │
                                                             └───────────────┘
```

**Two-process design** (following the nachyomi-bot pattern):

1. **`scripts/broadcast.js`** — Runs via GitHub Actions on a daily cron schedule. Scrapes today's halachot, broadcasts to all subscribers + optional channel, updates state.
2. **`src/index.js`** — Runs as a long-polling bot (Docker or VPS). Handles interactive commands (`/start`, `/stop`, `/today`, `/send`).

## Prerequisites

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org/) | >= 20 |
| npm | >= 8 |
| [Docker](https://www.docker.com/) *(optional)* | >= 20 |

You will also need:
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- Your **Telegram Chat ID** from [@userinfobot](https://t.me/userinfobot) (for admin notifications)

## Quick Start

### 1. Configure

```bash
cp .env.example .env
# Edit .env:
#   TELEGRAM_BOT_TOKEN=your_bot_token_here
#   ADMIN_CHAT_ID=your_chat_id_here
```

### 2. Run interactive bot

```bash
npm install
npm start
```

Or with Docker:

```bash
docker compose up -d
```

### 3. Enable daily broadcasts

Add these secrets to your GitHub repo settings:
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `TELEGRAM_CHANNEL_ID` (optional — for broadcasting to a channel)

The `daily-broadcast.yml` workflow runs automatically at 05:00 Israel time.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | **Yes** | — | Telegram bot token from @BotFather |
| `ADMIN_CHAT_ID` | No | — | Your Telegram chat ID for admin notifications and `/send` |
| `TELEGRAM_CHANNEL_ID` | No | — | Channel ID for daily broadcast (e.g., `@mychannel`) |
| `DAILY_API_URL` | No | Auto-derived | Override the scraper API URL if the site structure changes |
| `FORCE_BROADCAST` | No | `false` | Bypass time/duplicate checks in broadcast script |

## Bot Commands

| Command | Access | Description |
|---------|--------|-------------|
| `/start` | All users | Subscribe to daily halachot |
| `/stop` | All users | Unsubscribe from daily halachot |
| `/today` | All users | Receive today's halachot immediately |
| `/send` | Admin only | Manually trigger a broadcast to the current chat |

## Project Structure

```
├── src/
│   ├── index.js              # Interactive bot (polling)
│   ├── scraper.js             # Content scraping with fallback chain
│   ├── messageBuilder.js      # Telegram message formatting
│   └── utils/
│       ├── subscribers.js     # JSON-based subscriber management
│       ├── broadcastState.js  # Broadcast deduplication
│       ├── israelTime.js      # Israel timezone utilities
│       └── rateLimiter.js     # Rate limiting for commands
├── scripts/
│   └── broadcast.js           # Daily broadcast (GitHub Actions)
├── tests/
│   ├── unit/                  # Vitest unit tests
│   └── fixtures/              # HTML fixtures for scraper tests
├── .github/
│   ├── state/                 # Subscriber + broadcast state (committed)
│   └── workflows/
│       ├── daily-broadcast.yml
│       └── ci.yml
├── Dockerfile
├── docker-compose.yml
└── vitest.config.js
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## License & Attribution

Licensed under the [MIT License](LICENSE).

Audio content by [Rav Eliezer Melamed / Peninei Halacha](https://ph.yhb.org.il/).

<p align="center">
  <em>כל השונה הלכות בכל יום מובטח לו שהוא בן העולם הבא</em>
  <br>
  <sub>Anyone who studies halachot every day is assured a place in the World to Come (Megillah 28b)</sub>
</p>
