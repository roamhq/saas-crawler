/**
 * Request routing logic.
 *
 * All routes require Bearer token authentication.
 * Routes are matched by method + pathname.
 */

import type {
  Env,
  ApiResponse,
  GenerateRequest,
  SaveContentRequest,
  LlmsMeta,
} from '../types'
import { loadSiteConfig, listClientNames } from '../services/config'
import { FirecrawlClient } from '../services/firecrawl'
import { enrichSite } from '../services/enricher'
import { generateLlmsTxt } from '../services/generator'
import {
  saveContent,
  readContentByClientName,
  deleteContent,
  listGeneratedSites,
  saveEnrichmentCache,
  loadEnrichmentCache,
  computeHash,
  hostnameFromUrl,
} from '../services/storage'

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function authenticate(request: Request, env: Env): Response | null {
  const authHeader = request.headers.get('Authorization')

  // No API_SECRET configured - auth disabled (service binding only deploys)
  if (!env.API_SECRET) {
    return null
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.substring(7)
  if (token !== env.API_SECRET) {
    return jsonResponse({ ok: false, error: 'Invalid API token' }, 403)
  }

  return null // Auth passed
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  // Auth check
  const authError = authenticate(request, env)
  if (authError) return authError

  const url = new URL(request.url)
  const method = request.method
  const path = url.pathname

  // POST /generate
  if (method === 'POST' && path === '/generate') {
    return handleGenerate(request, env)
  }

  // GET /content?client={clientName}
  if (method === 'GET' && path === '/content') {
    return handleGetContent(url, env)
  }

  // PUT /content
  if (method === 'PUT' && path === '/content') {
    return handleSaveContent(request, env)
  }

  // DELETE /content?client={clientName}
  if (method === 'DELETE' && path === '/content') {
    return handleDeleteContent(url, env)
  }

  // GET /sites
  if (method === 'GET' && path === '/sites') {
    return handleListSites(env)
  }

  return jsonResponse({ ok: false, error: 'Not found' }, 404)
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /generate
 * Generate llms.txt for a site. Runs enrichment, stores in KV.
 */
async function handleGenerate(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: GenerateRequest
  try {
    body = (await request.json()) as GenerateRequest
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  if (!body.clientName) {
    return jsonResponse({ ok: false, error: 'Missing clientName' }, 400)
  }

  // Load site config from KV by clientName
  const config = await loadSiteConfig(env.KV_ROAM_CACHE, body.clientName)
  if (!config) {
    return jsonResponse(
      { ok: false, error: `Site config not found: ${body.clientName}` },
      404,
    )
  }

  // Check for cached enrichment first
  let enrichment = await loadEnrichmentCache(env.KV_ROAM_CACHE, body.clientName)

  if (!enrichment) {
    // Run enrichment pipeline
    const firecrawl = new FirecrawlClient(env.FIRECRAWL_API_KEY)
    enrichment = await enrichSite(config, firecrawl)

    // Cache enrichment data for 7 days
    await saveEnrichmentCache(env.KV_ROAM_CACHE, body.clientName, enrichment)
  }

  // Generate llms.txt content
  const content = generateLlmsTxt(config, enrichment)

  // Compute metadata
  const now = new Date().toISOString()
  const contentHash = await computeHash(content)
  const hostname = hostnameFromUrl(config.base_url)

  const meta: LlmsMeta = {
    clientName: body.clientName,
    siteCode: config.site_code,
    siteName: config.site_name,
    hostname,
    origin: config.base_url,
    generatedAt: now,
    contentHash,
    enrichedAt: enrichment.tagline ? now : '',
  }

  // Save to KV (body + headers + stale key)
  if (hostname) {
    await saveContent(env.KV_ROAM_CACHE, env.KV_ROAM_ORIGINS, hostname, content, meta)
  }

  return jsonResponse({
    ok: true,
    data: {
      content,
      metadata: meta,
    },
  })
}

/**
 * GET /content?client={clientName}
 * Read llms.txt from KV.
 */
async function handleGetContent(
  url: URL,
  env: Env,
): Promise<Response> {
  const clientName = url.searchParams.get('client')
  if (!clientName) {
    return jsonResponse({ ok: false, error: 'Missing client parameter' }, 400)
  }

  const result = await readContentByClientName(
    env.KV_ROAM_CACHE,
    env.KV_ROAM_ORIGINS,
    clientName,
  )
  if (!result) {
    return jsonResponse(
      { ok: false, error: `No content found for client: ${clientName}` },
      404,
    )
  }

  return jsonResponse({
    ok: true,
    data: {
      content: result.content,
      metadata: result.meta,
    },
  })
}

/**
 * PUT /content
 * Save edited llms.txt content to KV.
 */
async function handleSaveContent(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: SaveContentRequest
  try {
    body = (await request.json()) as SaveContentRequest
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  if (!body.clientName || !body.content) {
    return jsonResponse({ ok: false, error: 'Missing clientName or content' }, 400)
  }

  // Load site config to get hostname
  const config = await loadSiteConfig(env.KV_ROAM_CACHE, body.clientName)
  const hostname = config ? hostnameFromUrl(config.base_url) : ''

  const now = new Date().toISOString()
  const contentHash = await computeHash(body.content)

  const meta: LlmsMeta = {
    clientName: body.clientName,
    siteCode: config?.site_code ?? '',
    siteName: config?.site_name ?? body.clientName,
    hostname,
    origin: config?.base_url ?? '',
    generatedAt: now,
    contentHash,
    enrichedAt: '',
  }

  if (hostname) {
    await saveContent(env.KV_ROAM_CACHE, env.KV_ROAM_ORIGINS, hostname, body.content, meta)
  }

  return jsonResponse({
    ok: true,
    data: { metadata: meta },
  })
}

/**
 * DELETE /content?client={clientName}
 * Remove llms.txt from KV.
 */
async function handleDeleteContent(
  url: URL,
  env: Env,
): Promise<Response> {
  const clientName = url.searchParams.get('client')
  if (!clientName) {
    return jsonResponse({ ok: false, error: 'Missing client parameter' }, 400)
  }

  // Load config to get hostname for KV deletion
  const config = await loadSiteConfig(env.KV_ROAM_CACHE, clientName)
  if (config) {
    const hostname = hostnameFromUrl(config.base_url)
    if (hostname) {
      await deleteContent(env.KV_ROAM_CACHE, env.KV_ROAM_ORIGINS, hostname)
    }
  }

  // Also clean up meta + enrichment keys
  await env.KV_ROAM_CACHE.delete(`meta:${clientName}`)
  await env.KV_ROAM_CACHE.delete(`enrichment:${clientName}`)

  return jsonResponse({ ok: true })
}

/**
 * GET /sites
 * List all configured sites with generation status.
 */
async function handleListSites(env: Env): Promise<Response> {
  // Get all configured client names from KV
  const allClients = await listClientNames(env.KV_ROAM_CACHE)

  // Get generation status from meta: keys
  const generated = await listGeneratedSites(env.KV_ROAM_CACHE)

  const sites = allClients.map((name) => {
    const meta = generated.get(name)
    return {
      clientName: name,
      generated: !!meta,
      generatedAt: meta?.generatedAt ?? null,
      contentHash: meta?.contentHash ?? null,
    }
  })

  return jsonResponse({ ok: true, data: { sites } })
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse<T>(
  body: ApiResponse<T>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
