/**
 * KV storage operations for llms.txt content.
 *
 * All data lives in KV_ROAM_CACHE, using the same key format
 * as the existing Roam CDN worker and upload-llms.sh:
 *
 *   https://{origin}/llms.txt          -> body
 *   https://{origin}/llms.txt-headers  -> JSON response metadata
 *   stale:{origin}                     -> staleness timestamp
 *   enrichment:{clientName}            -> cached enrichment data
 *   meta:{clientName}                  -> generation metadata (LlmsMeta)
 *
 * clientName is the roam-manager handle (e.g. "portmacquarie", "whitsundays").
 */

import type { LlmsMeta, EnrichmentData } from '../types'

// ---------------------------------------------------------------------------
// Content operations
// ---------------------------------------------------------------------------

/**
 * Save llms.txt content to KV (body + headers + stale key).
 *
 * Uses the exact same key format as upload-llms.sh so the
 * Roam CDN worker serves it without any code changes.
 */
export async function saveContent(
  kv: KVNamespace,
  kvOrigins: KVNamespace,
  hostname: string,
  content: string,
  meta: LlmsMeta,
): Promise<boolean> {
  const origin = await kvOrigins.get(`origin:${hostname}`)
  if (!origin) {
    console.log(`[storage] No origin mapping for hostname: ${hostname}`)
    return false
  }

  const cacheKey = `https://${origin}/llms.txt`
  const hash = await computeHash(content)
  const now = new Date().toISOString()

  // Write body
  await kv.put(cacheKey, content)

  // Write headers (same format as upload-llms.sh)
  const headers = JSON.stringify({
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'X-Roam': 'HIT',
      'X-Cached-At': now,
      'X-Content-Hash': hash,
      'X-Robots-Tag': 'noindex',
    },
  })
  await kv.put(`${cacheKey}-headers`, headers)

  // Set stale key so CDN worker knows content was refreshed
  await kv.put(`stale:${origin}`, now)

  // Save generation metadata keyed by clientName
  await kv.put(`meta:${meta.clientName}`, JSON.stringify(meta))

  console.log(`[storage] Saved to KV: ${cacheKey}`)
  return true
}

/**
 * Read llms.txt content from KV by hostname.
 */
export async function readContent(
  kv: KVNamespace,
  kvOrigins: KVNamespace,
  hostname: string,
): Promise<{ content: string; meta: LlmsMeta | null } | null> {
  const origin = await kvOrigins.get(`origin:${hostname}`)
  if (!origin) return null

  const cacheKey = `https://${origin}/llms.txt`
  const content = await kv.get(cacheKey)
  if (!content) return null

  // Try to read generation metadata from headers
  let meta: LlmsMeta | null = null
  const headersRaw = await kv.get(`${cacheKey}-headers`)
  if (headersRaw) {
    try {
      const parsed = JSON.parse(headersRaw)
      meta = {
        clientName: '',
        siteCode: '',
        siteName: '',
        hostname,
        origin,
        generatedAt: parsed.headers?.['X-Cached-At'] ?? '',
        contentHash: parsed.headers?.['X-Content-Hash'] ?? '',
        enrichedAt: '',
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { content, meta }
}

/**
 * Read llms.txt content by clientName (looks up meta first to get hostname).
 */
export async function readContentByClientName(
  kv: KVNamespace,
  kvOrigins: KVNamespace,
  clientName: string,
): Promise<{ content: string; meta: LlmsMeta | null } | null> {
  const metaRaw = await kv.get(`meta:${clientName}`)
  if (!metaRaw) return null

  let meta: LlmsMeta
  try {
    meta = JSON.parse(metaRaw) as LlmsMeta
  } catch {
    return null
  }

  if (!meta.hostname) return null
  return readContent(kv, kvOrigins, meta.hostname)
}

/**
 * Delete llms.txt from KV (body + headers + stale key).
 */
export async function deleteContent(
  kv: KVNamespace,
  kvOrigins: KVNamespace,
  hostname: string,
): Promise<boolean> {
  const origin = await kvOrigins.get(`origin:${hostname}`)
  if (!origin) return false

  const cacheKey = `https://${origin}/llms.txt`
  await kv.delete(cacheKey)
  await kv.delete(`${cacheKey}-headers`)
  await kv.delete(`stale:${origin}`)

  console.log(`[storage] Deleted from KV: ${cacheKey}`)
  return true
}

/**
 * List all clients that have generated llms.txt content.
 * Scans meta:* keys, returns map of clientName -> LlmsMeta.
 */
export async function listGeneratedSites(
  kv: KVNamespace,
): Promise<Map<string, LlmsMeta>> {
  const result = new Map<string, LlmsMeta>()
  let cursor: string | undefined

  do {
    const list = await kv.list({ prefix: 'meta:', cursor })

    for (const key of list.keys) {
      const clientName = key.name.replace('meta:', '')
      const raw = await kv.get(key.name)
      if (raw) {
        try {
          result.set(clientName, JSON.parse(raw) as LlmsMeta)
        } catch {
          // Skip unparseable entries
        }
      }
    }

    cursor = list.list_complete ? undefined : list.cursor
  } while (cursor)

  return result
}

// ---------------------------------------------------------------------------
// Enrichment cache
// ---------------------------------------------------------------------------

/**
 * Save enrichment data to KV (avoids re-fetching Wikipedia/Firecrawl).
 */
export async function saveEnrichmentCache(
  kv: KVNamespace,
  clientName: string,
  enrichment: EnrichmentData,
): Promise<void> {
  await kv.put(`enrichment:${clientName}`, JSON.stringify(enrichment), {
    // Cache for 7 days - enrichment data doesn't change often
    expirationTtl: 7 * 24 * 60 * 60,
  })
}

/**
 * Load cached enrichment data from KV. Returns null if not cached.
 */
export async function loadEnrichmentCache(
  kv: KVNamespace,
  clientName: string,
): Promise<EnrichmentData | null> {
  const raw = await kv.get(`enrichment:${clientName}`)
  if (!raw) return null

  try {
    return JSON.parse(raw) as EnrichmentData
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of content, returned as hex string.
 */
export async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Extract hostname from a base URL.
 */
export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
