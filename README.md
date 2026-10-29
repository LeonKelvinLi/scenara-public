# Scenara

A prediction-market simulator with live market data and virtual funds.

[Try the app](https://scenara.vercel.app)

I built Scenara to practice full-stack product development around real event probabilities. Readers can explore markets, take simulated positions and follow their portfolio. There are no deposits or real-money trades.

This repository is a public source snapshot. The original build ran from October 2025 to April 2026. I resumed development in October 2026, restored the live app and continued improving the data, trading flows and interface.

## What I built

- A React Native and Expo interface for browsing markets, reading news, viewing price history and placing simulated trades.
- A Python and FastAPI backend for accounts, positions, balances, settlement and portfolio history.
- Polymarket data integration for public probabilities, charts, liquidity and resolution rules.
- English and Portuguese interfaces, with responsive layouts for mobile and web.
- Tests for authentication, account isolation, settlement, refunds, stale quotes and concurrent requests.

## How it fits together

| Part | Main code |
| --- | --- |
| Screens and navigation | `scenara-mobile/app`, `scenara-mobile/components` |
| Session, portfolio and market state | `scenara-mobile/src` |
| API routes and access checks | `scenara-backend/app/routers` |
| Market sync and settlement | `scenara-backend/app/services` |
| Database models | `scenara-backend/app/models` |
| Backend checks | `scenara-backend/tests` |

The app reads public Polymarket data. It does not submit real orders or use a trading-account credential. Simulated trades use the quoted probability and reject stale or closed markets.

## Run locally

Requires Python 3.11, uv, Node.js 20.19+ and npm.

```sh
git clone https://github.com/LeonKelvinLi/scenara-public.git
cd scenara-public
make setup
```

In separate terminals:

```sh
make api
make web
```

The API runs at `http://localhost:8000`. Expo prints the web preview address. Setup creates private local environment files and a local SQLite database. Supply your own credentials for any optional provider you enable.

## Check changes

```sh
make test
make build
```

Backend tests create a temporary SQLite database and disable workers, email and push delivery. They do not use the production database. An optional PostgreSQL test run accepts only a disposable `scenara_test` database on localhost.

The included GitHub workflow can be run manually. It checks the backend against a disposable PostgreSQL service, then checks and builds the web app.

## Deployment

The live web app uses Vercel. Its API and PostgreSQL database use Render. Set deployment credentials privately; none are included here. The backend refuses debug mode, a weak signing key or temporary SQLite storage in production.

## About me

Leon Kelvin Li — software engineer, founder of Curio and Scenara.

[Portfolio](https://leonkelvinli.github.io/Noctilucenty.github.io/) · [LinkedIn](https://www.linkedin.com/in/leon-kelvin-li/)
