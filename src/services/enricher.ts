/**
 * Enrichment pipeline orchestration.
 *
 * Runs Wikipedia enrichment, site scraping, and Firecrawl LLM extraction
 * to produce a complete EnrichmentData object for llms.txt generation.
 */

import type { SiteConfig, EnrichmentData, FaqItem } from '../types'
import { FirecrawlClient } from './firecrawl'
import { enrichFromWikipedia } from './wikipedia'

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full enrichment pipeline for a site.
 */
export async function enrichSite(
  config: SiteConfig,
  firecrawl: FirecrawlClient,
): Promise<EnrichmentData> {
  const llms = config.llms ?? {}

  const data: EnrichmentData = {
    tagline: '',
    description: '',
    geographic_scope: '',
    quick_facts: [],
    weather_intro: '',
    weather_months: [],
    site_tagline: '',
    site_description: '',
    organisation_name: llms.organisation_name ?? '',
    contact_email: llms.contact_email ?? '',
    section_intros: {},
    faq: [],
    featured_attractions: [],
    featured_experiences: [],
  }

  const wikiArticle = llms.wikipedia_article ?? ''
  const destName = llms.region_short_name ?? config.site_name
  const wikiUrl = wikiArticle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiArticle)}`
    : ''
  const aboutUrl = `${config.base_url.replace(/\/$/, '')}${llms.about_url ?? '/about'}`

  // Step 1: Wikipedia enrichment
  if (wikiArticle) {
    try {
      const wiki = await enrichFromWikipedia(wikiArticle)
      data.geographic_scope = wiki.geographic_scope
      data.quick_facts = wiki.quick_facts
      data.weather_months = wiki.weather_months
      data.weather_intro = wiki.weather_intro
      // Use Wikipedia description as fallback
      if (wiki.description) {
        data.description = wiki.description
      }
    } catch (err) {
      console.error('[enricher] Wikipedia enrichment failed:', err)
    }
  }

  // Step 2: Site scraping (homepage + about page)
  try {
    const siteData = await enrichFromSite(config.base_url, firecrawl)
    if (siteData.tagline) data.site_tagline = siteData.tagline
    if (siteData.description) data.site_description = siteData.description
    if (siteData.organisation_name) data.organisation_name = siteData.organisation_name
  } catch (err) {
    console.error('[enricher] Site scraping failed:', err)
  }

  // Step 3: LLM content generation via Firecrawl extract
  try {
    const generated = await generateContent(config, firecrawl, wikiUrl, aboutUrl, destName)
    if (generated.tagline) data.tagline = generated.tagline
    if (generated.description) data.description = generated.description
    if (generated.section_intros) data.section_intros = generated.section_intros
    if (generated.faq.length > 0) data.faq = generated.faq
  } catch (err) {
    console.error('[enricher] LLM content generation failed:', err)
  }

  // Step 4: Use config-provided featured content (manual curation)
  data.featured_attractions = llms.featured_attractions ?? []
  data.featured_experiences = llms.featured_experiences ?? []

  return data
}

// ---------------------------------------------------------------------------
// Site scraping
// ---------------------------------------------------------------------------

interface SiteScrapedData {
  tagline: string
  description: string
  organisation_name: string
}

async function enrichFromSite(
  baseUrl: string,
  firecrawl: FirecrawlClient,
): Promise<SiteScrapedData> {
  const result: SiteScrapedData = {
    tagline: '',
    description: '',
    organisation_name: '',
  }

  // Scrape homepage for meta description and site name
  try {
    const homepage = await firecrawl.scrape(baseUrl, ['markdown'])
    if (homepage.success && homepage.data?.metadata) {
      const meta = homepage.data.metadata
      result.tagline =
        meta.ogDescription ?? meta.description ?? ''
      result.organisation_name =
        meta.ogSiteName ?? cleanSiteTitle(meta.title ?? '') ?? ''
    }
  } catch (err) {
    console.error('[enricher] Homepage scrape error:', err)
  }

  // Scrape about page for description paragraphs
  try {
    const aboutResp = await firecrawl.scrape(`${baseUrl.replace(/\/$/, '')}/about`, ['markdown'])
    if (aboutResp.success && aboutResp.data?.markdown) {
      result.description = extractAboutDescription(aboutResp.data.markdown)
    }
  } catch (err) {
    console.error('[enricher] About page scrape error:', err)
  }

  return result
}

/**
 * Clean a page title by removing common suffixes.
 */
function cleanSiteTitle(title: string): string {
  for (const sep of [' | ', ' - ', ' \u2014 ']) {
    if (title.includes(sep)) {
      return title.split(sep)[0].trim()
    }
  }
  return title
}

/**
 * Extract the first 2-3 substantial paragraphs from markdown.
 */
function extractAboutDescription(markdown: string): string {
  const junkPhrases = [
    'skip to', 'enable accessibility', 'open the accessibility',
    'caught us napping', 'page not found', '404', 'cookie',
    'accept all', 'javascript', 'loading', 'sign up', 'subscribe',
    'newsletter', 'still browsing', 'worth a look', 'follow us',
    'terms and conditions', 'privacy policy', 'copyright',
    'all rights reserved', 'powered by',
  ]

  const paragraphs: string[] = []
  for (const line of markdown.split('\n\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed.startsWith('[')) {
      continue
    }
    if (trimmed.length < 50) continue
    if (junkPhrases.some((phrase) => trimmed.toLowerCase().includes(phrase))) {
      continue
    }
    paragraphs.push(trimmed)
    if (paragraphs.length >= 3) break
  }

  return paragraphs.join('\n\n')
}

// ---------------------------------------------------------------------------
// LLM content generation via Firecrawl extract
// ---------------------------------------------------------------------------

interface GeneratedContent {
  tagline: string
  description: string
  section_intros: Record<string, string>
  faq: FaqItem[]
}

async function generateContent(
  config: SiteConfig,
  firecrawl: FirecrawlClient,
  wikiUrl: string,
  aboutUrl: string,
  destName: string,
): Promise<GeneratedContent> {
  const result: GeneratedContent = {
    tagline: '',
    description: '',
    section_intros: {},
    faq: [],
  }

  const urls = [wikiUrl, aboutUrl].filter(Boolean)
  if (urls.length === 0) return result

  // Generate section intros
  result.section_intros = await generateSectionIntros(
    firecrawl, urls, destName, config.destination_paths,
  )

  // Generate FAQ
  result.faq = await generateFaq(firecrawl, urls, destName)

  // Generate tagline + description
  const td = await generateTaglineDescription(firecrawl, urls, destName)
  result.tagline = td.tagline
  result.description = td.description

  return result
}

async function generateSectionIntros(
  firecrawl: FirecrawlClient,
  urls: string[],
  destName: string,
  destPaths?: Array<{ path: string; name: string }>,
): Promise<Record<string, string>> {
  const properties: Record<string, unknown> = {
    accommodation: {
      type: 'string',
      description: `Write a 2-3 sentence summary of accommodation options in ${destName}. Mention specific areas, types of stays, and price range.`,
    },
    things_to_do: {
      type: 'string',
      description: `Write a 2-3 sentence summary of the main activities and attractions in ${destName}. Focus on the most popular and distinctive experiences.`,
    },
    food_and_drink: {
      type: 'string',
      description: `Write a 2-3 sentence summary of the dining scene in ${destName}. Mention notable food cultures, key dining areas, and specialties.`,
    },
    events: {
      type: 'string',
      description: `Write a 2-3 sentence summary of major events and festivals in ${destName}. Include event names and approximate timing.`,
    },
    plan_your_trip: {
      type: 'string',
      description: `Write a 2-3 sentence summary of how to get to ${destName} and practical travel info. Include airports, driving distances from major cities, and best time to visit.`,
    },
  }

  // Add destination-specific intros if multiple paths
  if (destPaths) {
    for (const dp of destPaths) {
      const pathKey = dp.path.replace(/^\//, '').replace(/-/g, '_')
      const pathName = dp.name || pathKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      properties[`destinations_${pathKey}`] = {
        type: 'string',
        description: `Write a 2-3 sentence summary of the '${pathName}' area/region of ${destName}. Describe what visitors will find there and key highlights.`,
      }
    }
  }

  const destPathDesc = destPaths
    ? ` Destination sub-regions: ${destPaths.map((p) => p.name || p.path).join(', ')}.`
    : ''

  try {
    const resp = await firecrawl.extract(
      urls,
      { type: 'object', properties },
      `You are writing content for ${destName}'s official tourism guide. Based on the page content, generate concise factual summaries for each section.${destPathDesc} Each summary should be 2-3 sentences, informative, and written for visitors.`,
    )

    const intros: Record<string, string> = {}
    if (resp.success && resp.data) {
      for (const key of Object.keys(properties)) {
        const val = resp.data[key]
        if (typeof val === 'string' && val) {
          intros[key] = val
        }
      }
    }
    return intros
  } catch (err) {
    console.error('[enricher] Section intros extraction error:', err)
    return {}
  }
}

async function generateFaq(
  firecrawl: FirecrawlClient,
  urls: string[],
  destName: string,
): Promise<FaqItem[]> {
  const properties: Record<string, unknown> = {}
  for (let i = 1; i <= 10; i++) {
    properties[`q${i}`] = {
      type: 'string',
      description: `Visitor question #${i} about ${destName}`,
    }
    properties[`a${i}`] = {
      type: 'string',
      description: `Factual 2-4 sentence answer to question #${i}`,
    }
  }

  try {
    const resp = await firecrawl.extract(
      urls,
      { type: 'object', properties },
      `Generate 10 frequently asked questions and answers about visiting ${destName}. Cover topics: how to get there, best time to visit, top activities, where to stay, weather, costs, family-friendliness, and unique features. Questions should be what real travellers would ask. Answers must be factual and 2-4 sentences.`,
    )

    const faq: FaqItem[] = []
    if (resp.success && resp.data) {
      for (let i = 1; i <= 10; i++) {
        const q = resp.data[`q${i}`]
        const a = resp.data[`a${i}`]
        if (typeof q === 'string' && typeof a === 'string' && q && a) {
          faq.push({ question: q, answer: a })
        }
      }
    }
    return faq
  } catch (err) {
    console.error('[enricher] FAQ extraction error:', err)
    return []
  }
}

async function generateTaglineDescription(
  firecrawl: FirecrawlClient,
  urls: string[],
  destName: string,
): Promise<{ tagline: string; description: string }> {
  try {
    const resp = await firecrawl.extract(
      urls,
      {
        type: 'object',
        properties: {
          tagline: {
            type: 'string',
            description: `Write a compelling 1-sentence tagline for ${destName} as a tourist destination. Should capture the essence of the place in under 120 characters.`,
          },
          description: {
            type: 'string',
            description: `Write a 3-4 paragraph overview of ${destName} for an official tourism guide. Cover: what the destination is, key natural/cultural features, main activities, and why visitors should come. Be factual and engaging.`,
          },
        },
      },
      `Write marketing content for ${destName}'s official tourism website. The tagline should be memorable and the description comprehensive but engaging.`,
    )

    if (resp.success && resp.data) {
      return {
        tagline: typeof resp.data.tagline === 'string' ? resp.data.tagline : '',
        description: typeof resp.data.description === 'string' ? resp.data.description : '',
      }
    }
    return { tagline: '', description: '' }
  } catch (err) {
    console.error('[enricher] Tagline/description extraction error:', err)
    return { tagline: '', description: '' }
  }
}
