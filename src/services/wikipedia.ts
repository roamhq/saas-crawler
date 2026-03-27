/**
 * Wikipedia REST API client for Cloudflare Workers.
 *
 * Extracts structured facts (infobox, climate table, summary) from
 * Wikipedia articles. Uses regex-based HTML parsing since Workers
 * don't have cheerio/jsdom.
 */

import type { WikipediaData, QuickFact, WeatherMonth } from '../types'

const REST_API = 'https://en.wikipedia.org/api/rest_v1'
const ACTION_API = 'https://en.wikipedia.org/w/api.php'
const USER_AGENT = 'Roamcrawler/2.1 (https://www.roamhq.io; enrichment)'

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Fetch and parse Wikipedia data for a tourism destination.
 */
export async function enrichFromWikipedia(
  articleTitle: string,
): Promise<WikipediaData> {
  const result: WikipediaData = {
    summary: '',
    description: '',
    coordinates: null,
    quick_facts: [],
    weather_months: [],
    weather_intro: '',
    geographic_scope: '',
  }

  // Step 1: Page summary via REST API
  const summary = await fetchPageSummary(articleTitle)
  if (summary) {
    result.summary = summary.extract ?? ''
    result.description = summary.extract ?? ''
    if (summary.coordinates) {
      result.coordinates = {
        lat: summary.coordinates.lat,
        lon: summary.coordinates.lon,
      }
    }
  }

  // Step 2: Full HTML for infobox + climate table
  const html = await fetchPageHtml(articleTitle)
  if (html) {
    const infobox = parseInfobox(html)

    // Fallback: parse coordinates from infobox if REST API didn't have them
    if (!result.coordinates && infobox['coordinates']) {
      const parsed = parseInfoboxCoordinates(infobox['coordinates'])
      if (parsed) {
        result.coordinates = parsed
      }
    }

    result.quick_facts = buildQuickFacts(
      summary ? { ...summary, coordinates: result.coordinates } : { coordinates: result.coordinates },
      infobox,
    )
    result.geographic_scope = buildGeographicScope(summary ?? {}, infobox)

    const climate = parseClimateTable(html)
    if (climate.length > 0) {
      result.weather_months = climate
      result.weather_intro = buildWeatherIntro(articleTitle, climate)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Wikipedia API calls
// ---------------------------------------------------------------------------

interface WikiSummary {
  title?: string
  extract?: string
  description?: string
  coordinates?: { lat: number; lon: number }
  [key: string]: unknown
}

async function fetchPageSummary(title: string): Promise<WikiSummary | null> {
  const url = `${REST_API}/page/summary/${encodeURIComponent(title)}`
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (resp.status === 200) {
      return (await resp.json()) as WikiSummary
    }
    return null
  } catch {
    return null
  }
}

async function fetchPageHtml(title: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    format: 'json',
    prop: 'text',
    disablelimitreport: 'true',
  })
  try {
    const resp = await fetch(`${ACTION_API}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (resp.status === 200) {
      const data = (await resp.json()) as {
        parse?: { text?: { '*'?: string } }
      }
      return data?.parse?.text?.['*'] ?? null
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// HTML parsing (regex-based for Workers compatibility)
// ---------------------------------------------------------------------------

/**
 * Extract key-value pairs from Wikipedia infobox table.
 * Uses regex since Workers don't have DOM parsing libraries.
 */
function parseInfobox(html: string): Record<string, string> {
  const infobox: Record<string, string> = {}

  // Find the infobox table
  const infoboxMatch = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>([\s\S]*?)<\/table>/i)
  if (!infoboxMatch) return infobox

  const tableHtml = infoboxMatch[1]

  // Extract rows with <th> and <td>
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowContent = rowMatch[1]

    const thMatch = rowContent.match(/<th[^>]*>([\s\S]*?)<\/th>/i)
    const tdMatch = rowContent.match(/<td[^>]*>([\s\S]*?)<\/td>/i)

    if (thMatch && tdMatch) {
      let key = stripHtml(thMatch[1]).toLowerCase().trim()
      let value = stripHtml(tdMatch[1]).trim()

      // Clean up common Wikipedia artifacts
      value = value
        .replace(/\xa0/g, ' ')
        .replace(/\[edit\]/g, '')
        .replace(/\[\d+\]/g, '')
        .replace(/\bkm\s*2\b/g, 'km\u00B2')
        .replace(/\bm\s*2\b/g, 'm\u00B2')
        .trim()

      if (key && value) {
        infobox[key] = value
      }
    }
  }

  return infobox
}

/**
 * Extract monthly climate data from Wikipedia climate table.
 */
function parseClimateTable(html: string): WeatherMonth[] {
  // Find tables with class "wikitable"
  const tableRegex = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableContent = tableMatch[1]
    const tableText = stripHtml(tableContent)

    // Check if table contains month names (at least 6)
    const monthCount = MONTHS_SHORT.filter((m) => tableText.includes(m)).length
    if (monthCount < 6) continue

    // Found a climate table — extract temperature rows
    const rows = extractTableRows(tableContent)

    let maxTemps: (number | null)[] = []
    let minTemps: (number | null)[] = []
    let maxScore = 0
    let minScore = 0

    for (const row of rows) {
      if (row.length < 13) continue

      const label = row[0].toLowerCase()
      const isRecord = label.includes('record')
      if (isRecord) continue

      let rowMaxScore = 0
      let rowMinScore = 0

      // Score-based matching for max temperatures
      if (label.includes('mean daily maximum') || label.includes('average high')) {
        rowMaxScore = 3
      } else if (label.includes('daily maximum')) {
        rowMaxScore = 2
      } else if (label.includes('mean maximum') && !label.includes('daily')) {
        rowMaxScore = 1
      }

      // Score-based matching for min temperatures
      if (label.includes('mean daily minimum') || label.includes('average low')) {
        rowMinScore = 3
      } else if (label.includes('daily minimum')) {
        rowMinScore = 2
      } else if (label.includes('mean minimum') && !label.includes('daily')) {
        rowMinScore = 1
      }

      if (rowMaxScore > 0 || rowMinScore > 0) {
        const temps = row.slice(1, 13).map(parseTemp)

        if (temps.length >= 12 && temps.some((t) => t !== null)) {
          if (rowMaxScore > 0 && rowMaxScore > maxScore) {
            maxTemps = temps
            maxScore = rowMaxScore
          } else if (rowMinScore > 0 && rowMinScore > minScore) {
            minTemps = temps
            minScore = rowMinScore
          }
        }
      }
    }

    // Build result if we found both max and min temperatures
    if (maxTemps.length >= 12 && minTemps.length >= 12) {
      const result: WeatherMonth[] = []
      for (let i = 0; i < 12; i++) {
        const entry: WeatherMonth = {
          month: MONTHS_FULL[i],
          min_c: minTemps[i] !== null ? Math.round(minTemps[i]!) : 0,
          max_c: maxTemps[i] !== null ? Math.round(maxTemps[i]!) : 0,
        }
        result.push(entry)
      }
      return result
    }
  }

  return []
}

/**
 * Extract rows from an HTML table as arrays of cell text.
 */
function extractTableRows(tableHtml: string): string[][] {
  const rows: string[][] = []
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cells: string[] = []
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi
    let cellMatch: RegExpExecArray | null

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim())
    }

    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  return rows
}

/**
 * Parse a temperature string from a Wikipedia climate cell.
 */
function parseTemp(text: string): number | null {
  let cleaned = text
    .replace(/\u2212/g, '-')
    .replace(/−/g, '-')
    .trim()

  // Strip parenthesized Fahrenheit values: "26.8(80.4)" -> "26.8"
  if (cleaned.includes('(')) {
    cleaned = cleaned.substring(0, cleaned.indexOf('('))
  }

  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

// ---------------------------------------------------------------------------
// Quick facts and geographic scope builders
// ---------------------------------------------------------------------------

function buildQuickFacts(
  summary: Record<string, unknown>,
  infobox: Record<string, string>,
): QuickFact[] {
  const facts: QuickFact[] = []

  // Coordinates
  const coords = summary.coordinates as { lat: number; lon: number } | null | undefined
  if (coords) {
    const latDir = coords.lat < 0 ? 'S' : 'N'
    const lonDir = coords.lon > 0 ? 'E' : 'W'
    facts.push({
      label: 'Coordinates',
      value: `${Math.abs(coords.lat).toFixed(2)}\u00B0${latDir} ${Math.abs(coords.lon).toFixed(2)}\u00B0${lonDir}`,
    })
  }

  // Area
  for (const key of ['area', 'area_total_km2', 'area total', 'total area']) {
    if (infobox[key]) {
      facts.push({ label: 'Area', value: infobox[key] })
      break
    }
  }

  // Population
  for (const key of ['population', 'population_total', 'population total', 'pop']) {
    if (infobox[key]) {
      facts.push({ label: 'Population', value: infobox[key] })
      break
    }
  }

  // Elevation
  for (const key of ['elevation', 'elevation_m']) {
    if (infobox[key]) {
      facts.push({ label: 'Elevation', value: infobox[key] })
      break
    }
  }

  // Established
  for (const key of ['established', 'named', 'founded', 'named for']) {
    if (infobox[key]) {
      facts.push({ label: 'Established', value: infobox[key] })
      break
    }
  }

  // Region
  for (const key of ['lga', 'local government area', 'region', 'state']) {
    if (infobox[key]) {
      facts.push({ label: 'Region', value: infobox[key] })
      break
    }
  }

  // UNESCO / Heritage
  for (const key of ['designation', 'criteria', 'part of', 'world heritage']) {
    if (infobox[key]) {
      facts.push({ label: 'World Heritage', value: infobox[key] })
      break
    }
  }

  return facts
}

function buildGeographicScope(
  summary: Record<string, unknown>,
  infobox: Record<string, string>,
): string {
  const parts: string[] = []

  const desc = summary.description as string | undefined
  if (desc) parts.push(desc)

  for (const key of ['state', 'region', 'lga']) {
    if (infobox[key]) {
      parts.push(infobox[key])
      break
    }
  }

  return parts.join('. ')
}

/**
 * Build a prose weather introduction from climate data.
 */
function buildWeatherIntro(
  _destination: string,
  climate: WeatherMonth[],
): string {
  if (climate.length === 0) return ''

  const maxTemps = climate
    .filter((m) => m.max_c !== 0)
    .map((m) => ({ month: m.month, temp: m.max_c }))
  const minTemps = climate
    .filter((m) => m.min_c !== 0)
    .map((m) => ({ month: m.month, temp: m.min_c }))

  if (maxTemps.length === 0 || minTemps.length === 0) return ''

  const hottest = maxTemps.reduce((a, b) => (b.temp > a.temp ? b : a))
  const coolestMax = maxTemps.reduce((a, b) => (b.temp < a.temp ? b : a))
  const coldestMin = minTemps.reduce((a, b) => (b.temp < a.temp ? b : a))

  return (
    `Temperatures range from ${coldestMin.temp}\u00B0C (${coldestMin.month}) ` +
    `to ${hottest.temp}\u00B0C (${hottest.month}). ` +
    `The coolest months are ${coolestMax.month} with daytime highs around ` +
    `${coolestMax.temp}\u00B0C.`
  )
}

/**
 * Parse coordinates from infobox text.
 * Handles: "-20.300; 148.933" or DMS "20\u00B018'S 148\u00B056'E"
 */
function parseInfoboxCoordinates(
  coordText: string,
): { lat: number; lon: number } | null {
  // Try decimal format: "-20.300; 148.933"
  const decimalMatch = coordText.match(/(-?\d+\.?\d*)\s*;\s*(-?\d+\.?\d*)/)
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1])
    const lon = parseFloat(decimalMatch[2])
    if (!isNaN(lat) && !isNaN(lon)) {
      return { lat, lon }
    }
  }

  // Try DMS format: "20\u00B018'S 148\u00B056'E"
  const dmsMatch = coordText.match(
    /(\d+)[°]\s*(\d+)[′']\s*([NS])\s+(\d+)[°]\s*(\d+)[′']\s*([EW])/,
  )
  if (dmsMatch) {
    let lat = parseFloat(dmsMatch[1]) + parseFloat(dmsMatch[2]) / 60
    if (dmsMatch[3] === 'S') lat = -lat
    let lon = parseFloat(dmsMatch[4]) + parseFloat(dmsMatch[5]) / 60
    if (dmsMatch[6] === 'W') lon = -lon
    return { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 }
  }

  return null
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags, decode common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
