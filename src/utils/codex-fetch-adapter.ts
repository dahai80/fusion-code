/**
 * OpenAI Codex API adapter for Fusion-Code
 * Provides compatibility layer between Claude's API expectations and OpenAI's Codex API
 */

import type { Message } from '../types/message.js'
import { logError } from './log.js'

/**
 * OpenAI message format for API requests
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{
    type: 'text' | 'image_url'
    text?: string
    image_url?: {
      url: string
    }
  }>
}

/**
 * OpenAI API response format
 */
interface OpenAIResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Convert Fusion-Code message format to OpenAI format
 * Returns null for message types that cannot be converted (system, attachment, progress)
 */
function convertToOpenAIMessage(message: Message): OpenAIMessage | null {
    if (message.type === 'user') {
        const role: 'user' = 'user' // log: fix TS2339
        const msgContent = message.message.content
        if (typeof msgContent === 'string') {
            return { role, content: msgContent }
        }
        // Handle multi-modal content blocks
        const content: Array<{
            type: 'text' | 'image_url'
            text?: string
            image_url?: { url: string }
        }> = []
        for (const item of msgContent) {
            if (item.type === 'text') {
                content.push({ type: 'text', text: item.text })
            } else if (item.type === 'image') {
                const src = item.source // log: fix TS2339
                content.push({
                    type: 'image_url',
                    image_url: {
                        url: src.type === 'base64'
                            ? `data:${src.media_type};base64,${src.data}`
                            : src.url, // log: fix TS2339
                    },
                })
            }
        }
        return { role, content }
    }

    if (message.type === 'assistant') {
        const role: 'assistant' = 'assistant' // log: fix TS2339
        const msgContent = message.message.content
        const content: Array<{
            type: 'text' | 'image_url'
            text?: string
            image_url?: { url: string }
        }> = []
        for (const block of msgContent) {
            if (block.type === 'text') {
                content.push({ type: 'text', text: block.text })
            }
        }
        return { role, content }
    }

    // System, attachment, and progress messages are not convertible
    return null
}

/**
 * Make a request to OpenAI Codex API
 */
export async function fetchCodexResponse(
  messages: Message[],
  model: string,
  options: {
    apiKey?: string
    baseUrl?: string
    stream?: boolean
  } = {}
): Promise<OpenAIResponse> {
  const { apiKey, baseUrl = 'https://api.openai.com/v1', stream = false } = options

  if (!apiKey) {
    throw new Error('OpenAI API key is required for Codex requests')
  }

  const openAIMessages = messages.map(convertToOpenAIMessage).filter((m): m is OpenAIMessage => m !== null)

  const requestBody = {
    model,
    messages: openAIMessages,
    stream,
    temperature: 0.7,
    max_tokens: 4096,
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as OpenAIResponse
    return data
  } catch (error) {
    logError(error)
    throw error
  }
}

/**
 * Convert OpenAI response to Fusion-Code format
 */
export function convertFromOpenAIResponse(response: OpenAIResponse): {
  content: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
} {
  const choice = response.choices[0]
  if (!choice) {
    throw new Error('No choices in OpenAI response')
  }

  return {
    content: choice.message.content,
    usage: {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
    },
  }
}