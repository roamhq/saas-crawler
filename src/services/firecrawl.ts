/**
 * Firecrawl HTTP API client for Cloudflare Workers.
 *
 * Direct HTTP calls to https://api.firecrawl.dev/v1/ — no CLI, no SDK.
 */

import type { ScrapeResult, ExtractResult } from '../types'

export class FirecrawlClient {
  private baseUrl = 'https://api.firecrawl.dev/v1'

  constructor(private apiKey: string) {}

  /**
   * Scrape a single URL and return content in requested formats.
   */
  async scrape(
    url: string,
    formats: string[] = ['markdown'],
  ): Promise<ScrapeResult> {
    const resp = await fetch(`${this.baseUrl}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ url, formats }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Firecrawl scrape failed (${resp.status}): ${text}`)
    }

    return (await resp.json()) as ScrapeResult
  }

  /**
   * Extract structured data from URLs using Firecrawl's LLM extraction.
   *
   * This is an async operation — the initial POST returns a job ID,
   * then we poll until completion.
   */
  async extract(
    urls: string[],
    schema: Record<string, unknown>,
    prompt: string,
  ): Promise<ExtractResult> {
    // Start the extraction job
    const startResp = await fetch(`${this.baseUrl}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ urls, schema, prompt }),
    })

    if (!startResp.ok) {
      const text = await startResp.text()
      throw new Error(`Firecrawl extract start failed (${startResp.status}): ${text}`)
    }

    const startData = (await startResp.json()) as {
      success: boolean
      id?: string
      data?: Record<string, unknown>
      status?: string
    }

    // If the response already contains data, return it directly
    if (startData.data && startData.status === 'completed') {
      return { success: true, data: startData.data, status: 'completed' }
    }

    // Otherwise, poll for results
    const jobId = startData.id
    if (!jobId) {
      return { success: false, status: 'no_job_id' }
    }

    return this.pollExtractJob(jobId)
  }

  /**
   * Poll an extract job until completion or timeout.
   */
  private async pollExtractJob(
    jobId: string,
    maxAttempts = 30,
    intervalMs = 2000,
  ): Promise<ExtractResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(intervalMs)

      const resp = await fetch(`${this.baseUrl}/extract/${jobId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      })

      if (!resp.ok) {
        continue
      }

      const data = (await resp.json()) as {
        success: boolean
        data?: Record<string, unknown>
        status?: string
      }

      if (data.status === 'completed') {
        return { success: true, data: data.data, status: 'completed' }
      }

      if (data.status === 'failed') {
        return { success: false, status: 'failed' }
      }

      // Still processing, keep polling
    }

    return { success: false, status: 'timeout' }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
