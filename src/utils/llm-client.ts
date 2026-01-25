// Unified LLM Client for Knowledge Database Operations

import { logger } from './logger.js';

export interface LLMClientConfig {
  baseURL?: string;
  timeout?: number;
  retries?: number;
  apiKey?: string;
}

export interface CompletionOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

export interface EmbeddingOptions {
  model?: string;
  batch_size?: number;
}

export interface CompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class UnifiedLLMClient {
  private baseURL: string;
  private timeout: number;
  private retries: number;
  private apiKey?: string;

  constructor(config: LLMClientConfig = {}) {
    this.baseURL = config.baseURL || process.env.LLM_API_URL || 'http://localhost:9000';
    this.timeout = config.timeout || parseInt(process.env.LLM_API_TIMEOUT || '30000');
    this.retries = config.retries || 3;
    this.apiKey = config.apiKey || process.env.LLM_API_KEY;
  }

  /**
   * Generate text completion for summarization
   */
  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const model = options.model || process.env.LLM_DEFAULT_MODEL || 'default';
    const maxTokens = options.max_tokens || 500;
    const temperature = options.temperature ?? 0.3;

    const requestBody = {
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: maxTokens,
      temperature,
      top_p: options.top_p,
      stop: options.stop,
    };

    logger.debug({ model, maxTokens, temperature }, 'Sending completion request');

    const response = await this.fetchWithRetry<CompletionResponse>(
      `${this.baseURL}/v1/chat/completions`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.choices || response.choices.length === 0) {
      throw new Error('No completion choices returned from LLM API');
    }

    const content = response.choices[0].message.content;
    logger.debug(
      {
        tokens: response.usage?.total_tokens,
        length: content.length,
      },
      'Completion received'
    );

    return content;
  }

  /**
   * Generate embeddings for deduplication
   */
  async embed(text: string | string[], options: EmbeddingOptions = {}): Promise<number[] | number[][]> {
    const model = options.model || 'default';
    const batchSize = options.batch_size || 20;

    const inputs = Array.isArray(text) ? text : [text];
    const batches = this.batchArray(inputs, batchSize);
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const requestBody = {
        model,
        input: batch,
      };

      logger.debug({ model, batchSize: batch.length }, 'Sending embedding request');

      const response = await this.fetchWithRetry<EmbeddingResponse>(
        `${this.baseURL}/v1/embeddings`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data returned from LLM API');
      }

      // Sort by index to maintain order
      const sortedEmbeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);

      allEmbeddings.push(...sortedEmbeddings);

      logger.debug(
        {
          count: sortedEmbeddings.length,
          dimensions: sortedEmbeddings[0]?.length,
        },
        'Embeddings received'
      );
    }

    // Return single array if input was a string, otherwise return array of arrays
    return Array.isArray(text) ? allEmbeddings : allEmbeddings[0];
  }

  /**
   * Health check
   */
  async health(): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry<any>(
        `${this.baseURL}/health`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
        1 // Only 1 retry for health check
      );

      logger.debug({ status: response.status }, 'LLM API health check');
      return response.status === 'ok' || response.status === 'healthy';
    } catch (err) {
      logger.warn({ err, baseURL: this.baseURL }, 'LLM API health check failed');
      return false;
    }
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    maxRetries: number = this.retries
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`LLM API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return data as T;
      } catch (err: any) {
        lastError = err;

        if (err.name === 'AbortError') {
          logger.warn(
            { attempt, maxRetries, timeout: this.timeout },
            'LLM API request timeout'
          );
        } else {
          logger.warn(
            { attempt, maxRetries, error: err.message },
            'LLM API request failed'
          );
        }

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          logger.debug({ delay }, 'Retrying after delay');
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`LLM API request failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Get request headers
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Split array into batches
   */
  private batchArray<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function
 */
export function createLLMClient(config?: LLMClientConfig): UnifiedLLMClient {
  return new UnifiedLLMClient(config);
}
