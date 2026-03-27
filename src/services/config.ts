/**
 * Site config loader - reads JSON configs from KV.
 *
 * Site configs live at config:{clientName} keys in KV_ROAM_CACHE,
 * where clientName matches the roam-manager handle (e.g. "portmacquarie").
 *
 * Upload via wrangler CLI:
 *   npx wrangler kv key put "config:portmacquarie" --path sites/portmacquarie.json \
 *     --namespace-id ec2c9c854b174240ad7ceb59bacf53cb
 */

import type { SiteConfig } from '../types'

/**
 * Load a single site config from KV by client name.
 */
export async function loadSiteConfig(
  kv: KVNamespace,
  clientName: string,
): Promise<SiteConfig | null> {
  const raw = await kv.get(`config:${clientName}`)
  if (!raw) return null

  try {
    return JSON.parse(raw) as SiteConfig
  } catch {
    console.error(`[config] Failed to parse config:${clientName}`)
    return null
  }
}

/**
 * List all available client names from KV.
 * Scans config:* keys.
 */
export async function listClientNames(kv: KVNamespace): Promise<string[]> {
  const names: string[] = []
  let cursor: string | undefined

  do {
    const list = await kv.list({ prefix: 'config:', cursor })

    for (const key of list.keys) {
      const name = key.name.replace('config:', '')
      if (name) names.push(name)
    }

    cursor = list.list_complete ? undefined : list.cursor
  } while (cursor)

  return names.sort()
}

/**
 * Load all site configs from KV.
 * Returns a map of clientName -> SiteConfig.
 */
export async function loadAllSiteConfigs(
  kv: KVNamespace,
): Promise<Map<string, SiteConfig>> {
  const names = await listClientNames(kv)
  const configs = new Map<string, SiteConfig>()

  for (const name of names) {
    const config = await loadSiteConfig(kv, name)
    if (config) {
      configs.set(name, config)
    }
  }

  return configs
}
