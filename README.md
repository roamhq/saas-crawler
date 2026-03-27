# roam-crawler

Cloudflare Worker that generates and stores `llms.txt` files for Roam tourism sites.

## What it does

1. Loads site config from KV (`config:{clientName}`)
2. Enriches with Wikipedia data (climate, facts, summary)
3. Scrapes site pages via Firecrawl API
4. Extracts structured data (FAQs, featured items) via Firecrawl LLM
5. Assembles a complete `llms.txt` markdown document
6. Stores in KV for serving by the Roam CDN worker

## Architecture

```
roam-manager (Next.js)
  |
  |-- POST /generate  -->  roam-crawler (this worker)
  |                          |-- Wikipedia REST API
  |                          |-- Firecrawl API (scrape + extract)
  |                          |-- KV_ROAM_CACHE (read config, write content)
  |                          |-- KV_ROAM_ORIGINS (hostname lookup)
  |
  |-- GET /sites/:name -->  reads from KV_ROAM_CACHE
```

## Project structure

```
src/
  index.ts              Entry point (CORS, fetch handler)
  types.ts              TypeScript interfaces
  handlers/
    fetch.ts            Request routing + API endpoints
  services/
    config.ts           Site config loader (KV)
    storage.ts          KV read/write operations
    generator.ts        llms.txt text assembly
    enricher.ts         Enrichment pipeline orchestration
    firecrawl.ts        Firecrawl HTTP API client
    wikipedia.ts        Wikipedia REST API client
```

## Development

```bash
npm install
npm run dev              # wrangler dev
npm run typecheck        # tsc --noEmit
npm run test             # vitest
```

## Deployment

```bash
npm run deploy           # dev
npm run deploy:staging   # staging
npm run deploy:production # production
```

## Environment variables

Set in `.dev.vars` for local development:

```
FIRECRAWL_API_KEY=fc-...
API_TOKEN=your-bearer-token
```
