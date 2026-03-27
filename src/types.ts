// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

export interface Env {
  KV_ROAM_CACHE: KVNamespace
  KV_ROAM_ORIGINS: KVNamespace
  FIRECRAWL_API_KEY: string
  API_SECRET: string
  ENVIRONMENT: string
}

// ---------------------------------------------------------------------------
// Site configuration (loaded from KV as JSON, key: config:{siteCode})
// ---------------------------------------------------------------------------

export interface DestinationPath {
  path: string
  name: string
}

export interface CategoryDef {
  name: string
  path: string
}

export interface RegionDef {
  name: string
  path: string
}

export interface QuickFact {
  label: string
  value: string
}

export interface WeatherMonth {
  month: string
  min_c: number
  max_c: number
}

export interface FaqItem {
  question: string
  answer: string
}

export interface FeaturedItem {
  name: string
  url: string
  description: string
}

export interface SectionDef {
  name: string
  content: string
}

export interface LlmsConfig {
  wikipedia_article?: string
  region_short_name?: string
  organisation_name?: string
  includes_atdw?: boolean
  output_dir?: string
  tagline?: string
  description?: string
  featured_count?: number
  sections?: SectionDef[]
  quick_facts?: QuickFact[]
  faq?: FaqItem[]
  featured_attractions?: FeaturedItem[]
  featured_experiences?: FeaturedItem[]
  weather_intro?: string
  weather_months?: WeatherMonth[]
  geographic_scope?: string
  contact_url?: string
  about_url?: string
  events_url?: string
  getting_here_url?: string
  visitor_info_url?: string
  itineraries_url?: string
  maps_url?: string
  blog_url?: string
  industry_url?: string
  contact_email?: string
  destination_path_names?: Record<string, string>
  section_intros?: Record<string, string>
}

export interface SchemaConfig {
  main_destination_name?: string
  main_destination_description?: string
  search_url_template?: string
}

export interface SiteConfig {
  client_name: string  // Roam manager handle (e.g. "portmacquarie", "whitsundays")
  site_code: string    // Legacy short code (e.g. "PMQ", "TWQ") — kept for YAML compat
  site_name: string
  base_url: string
  destination_path?: string
  destination_paths?: DestinationPath[]
  publisher_name?: string
  categories: CategoryDef[]
  regions?: RegionDef[]
  llms: LlmsConfig
  schema?: SchemaConfig
}

// ---------------------------------------------------------------------------
// Enrichment data
// ---------------------------------------------------------------------------

export interface EnrichmentData {
  tagline: string
  description: string
  geographic_scope: string
  quick_facts: QuickFact[]
  weather_intro: string
  weather_months: WeatherMonth[]
  site_tagline: string
  site_description: string
  organisation_name: string
  contact_email: string
  section_intros: Record<string, string>
  faq: FaqItem[]
  featured_attractions: FeaturedItem[]
  featured_experiences: FeaturedItem[]
}

// ---------------------------------------------------------------------------
// Wikipedia types
// ---------------------------------------------------------------------------

export interface WikipediaData {
  summary: string
  description: string
  coordinates: { lat: number; lon: number } | null
  quick_facts: QuickFact[]
  weather_months: WeatherMonth[]
  weather_intro: string
  geographic_scope: string
}

// ---------------------------------------------------------------------------
// Firecrawl types
// ---------------------------------------------------------------------------

export interface ScrapeMetadata {
  title?: string
  description?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogSiteName?: string
  [key: string]: unknown
}

export interface ScrapeResult {
  success: boolean
  data?: {
    html?: string
    rawHtml?: string
    markdown?: string
    metadata?: ScrapeMetadata
  }
}

export interface ExtractResult {
  success: boolean
  data?: Record<string, unknown>
  status?: string
}

// ---------------------------------------------------------------------------
// KV metadata (stored alongside content)
// ---------------------------------------------------------------------------

export interface LlmsMeta {
  clientName: string
  siteCode: string
  siteName: string
  hostname: string
  origin: string
  generatedAt: string
  contentHash: string
  enrichedAt: string
}

// ---------------------------------------------------------------------------
// API request / response types
// ---------------------------------------------------------------------------

export interface GenerateRequest {
  clientName: string
}

export interface SaveContentRequest {
  clientName: string
  content: string
}

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

// ---------------------------------------------------------------------------
// Category section mapping (for generator)
// ---------------------------------------------------------------------------

export interface MappedSection {
  section_type: string
  title: string
  search_path: string
  eat_path?: string
  drink_path?: string
}
