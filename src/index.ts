/**
 * Roamcrawler Worker — generates llms.txt files for tourism websites.
 *
 * Entry point. Handles CORS, delegates to router.
 */

import type { Env } from './types'
import { handleRequest } from './handlers/fetch'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      const response = await handleRequest(request, env)

      // Add CORS headers to all responses
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value)
      }

      return response
    } catch (error) {
      console.error('Worker error:', error)

      const message = error instanceof Error ? error.message : 'Internal Server Error'
      const body = JSON.stringify({ ok: false, error: message })

      return new Response(body, {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      })
    }
  },
}
