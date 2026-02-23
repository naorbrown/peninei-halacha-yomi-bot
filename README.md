<p align="center">
  <strong>@PenineiHalachaYomi Bot</strong>
</p>

<p align="center">
  A Telegram bot that delivers two daily <a href="https://ph.yhb.org.il/pninayomit/">Peninei Halacha</a> voice recordings every morning at 05:00 Israel time.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-blue?logo=docker">
  <img alt="Tests" src="https://img.shields.io/badge/tests-vitest-yellow?logo=vitest">
</p>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Bot Commands](#bot-commands)
- [Deployment](#deployment)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Contributing](#contributing)
- [License & Attribution](#license--attribution)

---

## Overview

**Peninei Halacha Yomi Bot** automatically scrapes the daily halachot (Jewish legal teachings) from [ph.yhb.org.il](https://ph.yhb.org.il/pninayomit/) and delivers them as audio messages to Telegram subscribers. Each morning, subscribers receive two voice recordings covering that day's halachot from the *Peninei Halacha* series by Rav Eliezer Melamed.

## Features

- **Daily delivery** — Two halachot sent automatically at 05:00 Israel time (DST-aware)
- **Audio + text** — Voice recordings with linked titles; graceful text fallback if audio is unavailable
- **Subscriber management** — Simple subscribe/unsubscribe via Telegram commands
- **Admin controls** — Manual broadcast trigger and startup/status notifications
- **Resilient broadcasting** — Rate-limit backoff, blocked-user cleanup, per-message error isolation
- **Security hardened** — URL allowlist validation, input escaping, request timeouts
- **Lightweight** — Single-file bot (~260 lines), SQLite storage, minimal dependencies
- **Docker-ready** — Multi-stage build with Alpine for small production images

## Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌───────────────┐
│   Telegram   │◄─────►│    bot.js         │──────►│  ph.yhb.org.il│
│   Users      │       │                  │       │  (scraper)    │
└──────────────┘       │  ┌────────────┐  │       └───────────────┘
                       │  │  node-cron │  │
                       │  │  05:00 IST │  │       ┌───────────────┐
                       │  └─────┬──────┘  │       │  SQLite DB    │
                       │        │         │──────►│  ./data/bot.db│
                       │        ▼         │       └───────────────┘
                       │   dailyJob()     │
                       └──────────────────┘
```

**Data flow:**

1. `node-cron` triggers `dailyJob()` at 05:00 Asia/Jerusalem (or admin triggers via `/send`)
2. Scraper fetches today's page from the Peninei Halacha API, parses HTML with Cheerio
3. Extracts halacha titles, page links, and audio URLs; validates against allowed domains
4. Iterates over active subscribers from SQLite, sends audio messages via Grammy
5. Handles errors per-subscriber: removes blocked users (403), backs off on rate limits (429)
6. Reports broadcast results to admin via Telegram

## Prerequisites

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org/) | >= 18 |
| npm | >= 8 |
| [Docker](https://www.docker.com/) *(optional)* | >= 20 |

You will also need:
- A **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- Your **Telegram Chat ID** from [@userinfobot](https://t.me/userinfobot) (for admin notifications)

## Quick Start

### Local

```bash
# 1. Clone the repository
git clone https://github.com/naorbrown/peninei-halacha-yomi-bot.git
cd peninei-halacha-yomi-bot

# 2. Configure environment
cp .env.example .env
# Edit .env and set BOT_TOKEN and ADMIN_CHAT_ID

# 3. Install dependencies
npm install

# 4. Start the bot
npm start
```

### Docker

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env and set BOT_TOKEN and ADMIN_CHAT_ID

# 2. Build and run
docker compose up -d

# View logs
docker compose logs -f bot
```

The SQLite database is persisted in `./data/` via a Docker volume mount.

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and set the required values.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BOT_TOKEN` | **Yes** | — | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_CHAT_ID` | No | — | Your Telegram chat ID for admin notifications and `/send` access |
| `DB_PATH` | No | `./data/bot.db` | Path to the SQLite database file |
| `DAILY_API_URL` | No | Auto-derived | Override the scraper API URL if the site structure changes |

### Getting Your Tokens

1. **BOT_TOKEN** — Open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts. Copy the token it gives you.
2. **ADMIN_CHAT_ID** — Message [@userinfobot](https://t.me/userinfobot) in Telegram. It will reply with your numeric chat ID.

## Bot Commands

| Command | Access | Description |
|---------|--------|-------------|
| `/start` | All users | Subscribe to daily halachot |
| `/stop` | All users | Unsubscribe from daily halachot |
| `/today` | All users | Receive today's halachot immediately |
| `/send` | Admin only | Manually trigger the daily broadcast |

## Deployment

### Docker (Recommended)

The included `Dockerfile` uses a multi-stage build to produce a minimal Alpine-based image:

```bash
# Build and start
docker compose up -d --build

# Stop
docker compose down

# View logs
docker compose logs -f bot
```

The `docker-compose.yml` configures:
- **Automatic restart** (`unless-stopped`) — the bot restarts on crash or host reboot
- **Environment** — loaded from `.env`
- **Data persistence** — `./data` mounted as a volume for the SQLite database

### Manual (systemd)

For running directly on a Linux server:

```ini
# /etc/systemd/system/peninei-bot.service
[Unit]
Description=Peninei Halacha Yomi Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/peninei-halacha-yomi-bot
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/peninei-halacha-yomi-bot/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now peninei-bot
```

## Testing

The project uses [Vitest](https://vitest.dev/) for end-to-end testing with comprehensive mocking of external dependencies (Telegram API, web scraping, database).

```bash
# Run the full test suite
npm test

# Run in watch mode during development
npm run test:watch

# Generate a coverage report
npm run test:coverage
```

### Test Coverage

The E2E test suite covers:

| Area | What's Tested |
|------|---------------|
| **Scraper** | HTML parsing, audio URL extraction, fallback logic, protocol normalization, error handling |
| **Database** | Subscriber CRUD, idempotent operations, active/inactive state management |
| **Bot commands** | `/start`, `/stop`, `/today`, `/send` (including auth checks) |
| **Daily broadcast** | Full scrape-to-send flow, blocked-user cleanup, rate-limit backoff, admin notifications |
| **URL validation** | Allowed domain checks, malicious URL rejection, edge cases |
| **Markdown escaping** | Special character handling for Telegram's Markdown parser |
| **Error handling** | Network failures, malformed HTML, empty responses, concurrent job prevention |

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Set BOT_TOKEN in .env` on startup | Missing or placeholder token | Set a valid bot token in `.env` |
| `ADMIN_CHAT_ID is set but not a valid integer` | Non-numeric admin ID | Use the numeric ID from [@userinfobot](https://t.me/userinfobot) |
| Bot starts but no messages at 05:00 | No subscribers yet | Send `/start` to the bot in Telegram |
| `No halacha links found` in logs | Site structure changed | Check if [ph.yhb.org.il](https://ph.yhb.org.il/pninayomit/) is reachable; set `DAILY_API_URL` if the API path changed |
| `HTTP 429` / rate limit warnings | Too many subscribers | The bot automatically backs off; consider spacing out messages further |
| Audio not playing | CDN issue or format change | The bot falls back to text-only; check audio URLs manually |
| Docker build fails on `better-sqlite3` | Missing native build tools | The multi-stage Dockerfile handles this; ensure Docker BuildKit is enabled |

## Security

This bot has been hardened against common attack vectors:

- **URL allowlisting** — All scraped URLs are validated against a set of known-good domains before use
- **Input escaping** — Telegram Markdown special characters are escaped to prevent formatting injection
- **Request timeouts** — All HTTP requests have a 15-second timeout to prevent hanging
- **Admin authorization** — The `/send` command is restricted to the configured admin chat ID
- **Graceful shutdown** — Handles SIGINT/SIGTERM, stops cron, closes DB connections cleanly
- **Rate-limit compliance** — Respects Telegram's 429 responses with dynamic backoff
- **No secrets in code** — All credentials are loaded from environment variables

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Write tests for any new functionality
4. Ensure all tests pass (`npm test`)
5. Commit with a clear message and open a pull request

## License & Attribution

Licensed under the [MIT License](LICENSE).

Audio content by [Rav Eliezer Melamed / Peninei Halacha](https://ph.yhb.org.il/).

<p align="center">
  <em>כל השונה הלכות בכל יום מובטח לו שהוא בן העולם הבא</em>
  <br>
  <sub>Anyone who studies halachot every day is assured a place in the World to Come (Megillah 28b)</sub>
</p>
