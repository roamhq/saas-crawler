# Development rules

## Code style

- No `any` - use `unknown` + type guards
- Use `??` not `||` for null coalescing
- Clone responses before consuming: `response.clone()`
- Never block response delivery - use `ctx.waitUntil()` for background work
- Parallel KV calls with `Promise.all()`

## Directory structure

- `src/index.ts` - entry point only (CORS, error handling)
- `src/types.ts` - all TypeScript interfaces
- `src/handlers/` - request routing
- `src/services/` - business logic (one concern per file)

## KV key patterns

- `config:{clientName}` - site configuration JSON
- `https://{origin}/llms.txt` - generated content body
- `https://{origin}/llms.txt-headers` - response metadata JSON
- `stale:{origin}` - staleness timestamp
- `enrichment:{clientName}` - cached enrichment data
- `meta:{clientName}` - generation metadata (LlmsMeta)

## API authentication

All routes require `Authorization: Bearer <API_TOKEN>` header.

## Testing

Run `npm run test` before pushing. Typecheck with `npm run typecheck`.
