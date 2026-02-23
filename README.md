# @PenineiHalachaYomi

Telegram bot that sends 2 daily Peninei Halacha voice recordings at 05:00 Israel time.

Source: [ph.yhb.org.il/pninayomit](https://ph.yhb.org.il/pninayomit/)

## Setup

```bash
cp .env.example .env        # add your BOT_TOKEN and ADMIN_CHAT_ID
npm install
npm start
```

Or with Docker: `docker compose up -d`

## Commands

- `/start` — Subscribe
- `/stop` — Unsubscribe
- `/today` — Get today's halachot now
- `/send` — Force daily broadcast (admin only)

## How to get tokens

1. **BOT_TOKEN**: Message [@BotFather](https://t.me/BotFather), send `/newbot`
2. **ADMIN_CHAT_ID**: Message [@userinfobot](https://t.me/userinfobot)

## Architecture

One file (`bot.js`, ~150 lines). Scrapes the daily page, extracts audio URLs, sends to subscribers. Cron at 05:00 `Asia/Jerusalem` (DST-aware). SQLite stores subscribers.

---

*Audio by [Rav Eliezer Melamed / Peninei Halacha](https://ph.yhb.org.il/). כל השונה הלכות בכל יום מובטח לו שהוא בן העולם הבא.*
