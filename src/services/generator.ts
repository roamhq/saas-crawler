/**
 * llms.txt text assembly.
 *
 * Takes a SiteConfig + EnrichmentData and produces a complete llms.txt
 * markdown document following the content-rich pattern: prose descriptions,
 * destination summaries, contextual section intros, weather, FAQ.
 */

import type {
  SiteConfig,
  EnrichmentData,
  CategoryDef,
  MappedSection,
  FaqItem,
  WeatherMonth,
  FeaturedItem,
} from '../types'

// ---------------------------------------------------------------------------
// Category section mapping (ported from Python CategorySectionMapper)
// ---------------------------------------------------------------------------

const CATEGORY_ALIASES: Record<string, string> = {
  stay: 'accommodation',
  accommodation: 'accommodation',
  see: 'attractions',
  attractions: 'attractions',
  do: 'tours',
  tours: 'tours',
  experiences: 'things_to_do',
  eat: 'food_drink',
  'eat drink': 'food_drink',
  'eat+drink': 'food_drink',
  food: 'food_drink',
  'food drink': 'food_drink',
  'food & drink': 'food_drink',
  drink: 'drink',
  events: 'events',
  "what's on": 'events',
  'whats on': 'events',
}

const SECTION_TITLES: Record<string, string> = {
  accommodation: 'Accommodation',
  attractions: 'Attractions & Sightseeing',
  tours: 'Tours & Experiences',
  things_to_do: 'Things To Do',
  events: 'Events & Festivals',
  food_drink: 'Food & Drink',
}

function normaliseCategory(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/%27/g, "'")
    .replace(/\+/g, ' ')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
}

function mapCategories(categories: CategoryDef[]): MappedSection[] {
  const sections: MappedSection[] = []
  const seenTypes = new Set<string>()
  let drinkPath = ''

  for (const cat of categories) {
    const normalised = normaliseCategory(cat.name)
    const sectionType = CATEGORY_ALIASES[normalised]

    if (!sectionType) {
      sections.push({
        section_type: 'generic',
        title: cat.name,
        search_path: cat.path,
      })
      continue
    }

    if (sectionType === 'drink') {
      drinkPath = cat.path
      const existing = sections.find((s) => s.section_type === 'food_drink')
      if (existing) {
        existing.drink_path = cat.path
      } else if (!seenTypes.has('food_drink')) {
        seenTypes.add('food_drink')
        sections.push({
          section_type: 'food_drink',
          title: 'Food & Drink',
          search_path: cat.path,
          eat_path: '',
          drink_path: cat.path,
        })
      }
      continue
    }

    if (sectionType === 'food_drink') {
      if (!seenTypes.has('food_drink')) {
        seenTypes.add('food_drink')
        sections.push({
          section_type: 'food_drink',
          title: 'Food & Drink',
          search_path: cat.path,
          eat_path: cat.path,
          drink_path: drinkPath,
        })
      }
      continue
    }

    if (seenTypes.has(sectionType)) continue
    seenTypes.add(sectionType)

    sections.push({
      section_type: sectionType,
      title: SECTION_TITLES[sectionType] ?? cat.name,
      search_path: cat.path,
    })
  }

  return sections
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the complete llms.txt markdown content.
 */
export function generateLlmsTxt(
  config: SiteConfig,
  enrichment: EnrichmentData,
): string {
  const lines: string[] = []
  const llms = config.llms ?? {}
  const baseUrl = config.base_url
  const destName = llms.region_short_name ?? config.site_name

  // Use config values first, fall back to enrichment
  const tagline = llms.tagline ?? enrichment.tagline ?? ''
  const description = llms.description ?? enrichment.description ?? ''
  const geoScope = llms.geographic_scope ?? enrichment.geographic_scope ?? ''
  const quickFacts = llms.quick_facts?.length ? llms.quick_facts : enrichment.quick_facts
  const weatherIntro = llms.weather_intro ?? enrichment.weather_intro ?? ''
  const weatherMonths = llms.weather_months?.length ? llms.weather_months : enrichment.weather_months
  const faq = llms.faq?.length ? llms.faq : enrichment.faq
  const featuredAttractions = llms.featured_attractions?.length
    ? llms.featured_attractions
    : enrichment.featured_attractions
  const featuredExperiences = llms.featured_experiences?.length
    ? llms.featured_experiences
    : enrichment.featured_experiences
  const sectionIntros = {
    ...(enrichment.section_intros ?? {}),
    ...(llms.section_intros ?? {}),
  }
  const orgName = llms.organisation_name ?? enrichment.organisation_name ?? config.site_name

  // Header
  lines.push(`# ${destName}`)
  lines.push('')

  // Tagline blockquote
  if (tagline) {
    lines.push(`> ${tagline.trim()}`)
    lines.push('')
  }

  // Extended description
  if (description) {
    lines.push(description.trim())
    lines.push('')
  } else {
    lines.push(
      `${config.site_name} is the official destination marketing website ` +
      `for ${destName}, providing authoritative information about accommodation, ` +
      `attractions, dining, events, and experiences.`,
    )
    lines.push('')
  }

  // Quick Facts
  lines.push('## Quick Facts')
  lines.push('')
  if (geoScope) {
    lines.push(`- **Geographic Scope:** ${geoScope}`)
  }
  for (const fact of quickFacts) {
    lines.push(`- **${fact.label}:** ${fact.value}`)
  }
  if (baseUrl) {
    lines.push(`- **Official Website:** ${baseUrl}`)
  }
  lines.push('- **Data Source:** Listings managed via [Roam](https://www.roamhq.io), Australia\'s leading destination marketing platform')
  lines.push(`- **Last Updated:** ${new Date().toISOString().split('T')[0]}`)
  lines.push('')

  // Destinations section
  lines.push(...generateDestinationsSection(config, sectionIntros))

  // Featured content
  lines.push(...generateFeaturedContent(featuredAttractions, featuredExperiences, baseUrl))

  // Custom sections from config
  if (llms.sections?.length) {
    for (const section of llms.sections) {
      lines.push(`## ${section.name}`)
      lines.push('')
      if (section.content) {
        lines.push(section.content)
        lines.push('')
      }
    }
  }

  // Standard sections with prose intros
  lines.push(...generateStandardSections(config, sectionIntros, baseUrl))

  // Weather & Climate
  lines.push(...generateWeatherSection(weatherIntro, weatherMonths))

  // FAQ
  lines.push(...generateFaqSection(faq))

  // Usage guidelines / attribution
  lines.push(...generateUsageGuidelines(config.site_name, orgName, llms.includes_atdw ?? true))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Section generators
// ---------------------------------------------------------------------------

function generateDestinationsSection(
  config: SiteConfig,
  sectionIntros: Record<string, string>,
): string[] {
  const lines: string[] = []
  const paths = config.destination_paths
  const pathNames = config.llms?.destination_path_names ?? {}

  if (!paths || paths.length === 0) return lines

  lines.push('## Destinations')
  lines.push('')

  for (const dp of paths) {
    const groupName = pathNames[dp.path] ?? dp.name ?? dp.path.replace(/^\//, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    lines.push(`### ${groupName}`)
    lines.push('')

    // Add path-specific intro if available
    const pathKey = dp.path.replace(/^\//, '').replace(/-/g, '_')
    const intro = sectionIntros[`destinations_${pathKey}`]
    if (intro) {
      lines.push(intro.trim())
      lines.push('')
    }

    // Link to the destination path
    lines.push(`- [Explore ${groupName}](${config.base_url}${dp.path})`)
    lines.push('')
  }

  return lines
}

function generateFeaturedContent(
  attractions: FeaturedItem[],
  experiences: FeaturedItem[],
  baseUrl: string,
): string[] {
  const lines: string[] = []

  if (attractions.length > 0) {
    lines.push('## Top Attractions')
    lines.push('')
    for (const item of attractions) {
      const url = item.url.startsWith('http') ? item.url : `${baseUrl}${item.url}`
      lines.push(`- [${item.name}](${url}): ${item.description}`)
    }
    lines.push('')
  }

  if (experiences.length > 0) {
    lines.push('## Featured Experiences')
    lines.push('')
    for (const item of experiences) {
      const url = item.url.startsWith('http') ? item.url : `${baseUrl}${item.url}`
      lines.push(`- [${item.name}](${url}): ${item.description}`)
    }
    lines.push('')
  }

  return lines
}

function generateStandardSections(
  config: SiteConfig,
  sectionIntros: Record<string, string>,
  baseUrl: string,
): string[] {
  const lines: string[] = []

  if (config.categories?.length) {
    const mapped = mapCategories(config.categories)

    for (const section of mapped) {
      lines.push(...renderSection(section, sectionIntros, baseUrl))
    }
  }

  // Plan Your Trip (always)
  const llms = config.llms ?? {}
  const planIntro = sectionIntros['plan_your_trip'] ?? ''
  lines.push('## Plan Your Trip')
  lines.push('')
  if (planIntro) {
    lines.push(planIntro.trim())
    lines.push('')
  }
  if (llms.visitor_info_url) {
    lines.push(`- [Visitor Information](${baseUrl}${llms.visitor_info_url}): Practical travel planning guide`)
  }
  if (llms.getting_here_url) {
    lines.push(`- [Getting Here](${baseUrl}${llms.getting_here_url}): Transport options and directions`)
  }
  if (llms.itineraries_url) {
    lines.push(`- [Itineraries](${baseUrl}${llms.itineraries_url}): Suggested multi-day trip plans`)
  }
  if (llms.maps_url) {
    lines.push(`- [Maps](${baseUrl}${llms.maps_url}): Interactive destination maps`)
  }
  lines.push('')

  // About section (always)
  lines.push('## About')
  lines.push('')
  lines.push(`- [About Us](${baseUrl}${llms.about_url ?? '/about'}): About the organisation`)
  if (llms.contact_url) {
    lines.push(`- [Contact](${baseUrl}${llms.contact_url}): Get in touch`)
  }
  if (llms.blog_url) {
    lines.push(`- [Blog](${baseUrl}${llms.blog_url}): Latest stories and travel inspiration`)
  }
  if (llms.industry_url) {
    lines.push(`- [Industry](${baseUrl}${llms.industry_url}): Tourism industry information`)
  }
  lines.push('')

  return lines
}

function renderSection(
  section: MappedSection,
  sectionIntros: Record<string, string>,
  baseUrl: string,
): string[] {
  const lines: string[] = []
  const intro = sectionIntros[section.section_type] ?? sectionIntros[section.section_type.replace(/_/g, '_')] ?? ''

  lines.push(`## ${section.title}`)
  lines.push('')

  if (intro) {
    lines.push(intro.trim())
    lines.push('')
  }

  // Generate search links based on section type
  switch (section.section_type) {
    case 'accommodation':
      lines.push(`- [All Accommodation](${baseUrl}${section.search_path}): Browse all stays`)
      lines.push(`- [Hotels & Resorts](${baseUrl}/search/Stay?st=HOTEL): Full-service hotels and resort properties`)
      lines.push(`- [Holiday Houses & Apartments](${baseUrl}/search/Stay?st=SELFCONT): Self-contained stays for families and groups`)
      lines.push(`- [B&Bs & Guesthouses](${baseUrl}/search/Stay?st=BEDBREAKFAST): Boutique stays with local character`)
      lines.push(`- [Caravan Parks & Camping](${baseUrl}/search/Stay?st=CARAVAN): Outdoor and budget-friendly accommodation`)
      break

    case 'attractions':
      lines.push(`- [All Attractions](${baseUrl}${section.search_path}): Must-see places across the region`)
      lines.push(`- [Nature & Wildlife](${baseUrl}/search/See?at=NATURAL): Natural wonders and wildlife encounters`)
      lines.push(`- [Museums & Galleries](${baseUrl}/search/See?at=MUSEUM): Cultural attractions and exhibitions`)
      break

    case 'tours':
      lines.push(`- [All Tours](${baseUrl}${section.search_path}): Guided experiences and activities`)
      lines.push(`- [Adventure Activities](${baseUrl}/search/Do?at=ADVENTURE): Outdoor and adrenaline experiences`)
      break

    case 'things_to_do':
      lines.push(`- [All Experiences](${baseUrl}${section.search_path}): Things to see and do`)
      break

    case 'food_drink':
      lines.push(`- [All Dining](${baseUrl}${section.search_path}): Restaurants, cafes, and bars`)
      if (section.eat_path && section.eat_path !== section.search_path) {
        lines.push(`- [Eat](${baseUrl}${section.eat_path}): Restaurants and cafes`)
      }
      if (section.drink_path) {
        lines.push(`- [Drink](${baseUrl}${section.drink_path}): Bars, wineries, and breweries`)
      }
      break

    case 'events':
      lines.push(`- [All Events](${baseUrl}${section.search_path}): What's on and upcoming festivals`)
      break

    default:
      lines.push(`- [Browse ${section.title}](${baseUrl}${section.search_path})`)
      break
  }

  lines.push('')
  return lines
}

function generateWeatherSection(
  weatherIntro: string,
  weatherMonths: WeatherMonth[],
): string[] {
  const lines: string[] = []

  if (!weatherIntro && weatherMonths.length === 0) return lines

  lines.push('## Weather & Climate')
  lines.push('')

  if (weatherIntro) {
    lines.push(weatherIntro.trim())
    lines.push('')
  }

  if (weatherMonths.length > 0) {
    lines.push('| Month | Min (\u00B0C) | Max (\u00B0C) |')
    lines.push('|-------|----------|----------|')
    for (const m of weatherMonths) {
      lines.push(`| ${m.month} | ${m.min_c} | ${m.max_c} |`)
    }
    lines.push('')
  }

  return lines
}

function generateFaqSection(faq: FaqItem[]): string[] {
  const lines: string[] = []

  if (faq.length === 0) return lines

  lines.push('## Frequently Asked Questions')
  lines.push('')

  for (const item of faq) {
    lines.push(`### ${item.question}`)
    lines.push(item.answer.trim())
    lines.push('')
  }

  return lines
}

function generateUsageGuidelines(
  siteName: string,
  orgName: string,
  includesAtdw: boolean,
): string[] {
  const lines: string[] = []

  lines.push('---')
  lines.push(`*Content sourced from ${siteName} (${orgName}). Listings managed via [Roam](https://www.roamhq.io).${includesAtdw ? ' Includes data licensed from the Australian Tourism Data Warehouse (ATDW).' : ''}*`)
  lines.push('')
  lines.push('*This file is designed for consumption by large language models (LLMs) and AI assistants. For human visitors, please use the official website linked above.*')

  return lines
}
