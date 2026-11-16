import {
  accountSchema,
  apiErrorSchema,
  chainsResponseSchema,
  executionsResponseSchema,
  healthSchema,
  type Account,
  type Health,
} from '@rulebook/shared';
import type { z } from 'zod';

/** A failed API call; always carries the machine code, raw detail, and HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...init?.headers },
    });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      throw new ApiError(
        parsed.success ? parsed.data.error.code : 'http_error',
        parsed.success ? parsed.data.error.message : `Request failed with ${response.status}`,
        parsed.success ? (parsed.data.error.detail ?? null) : null,
        response.status,
      );
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      throw new ApiError('invalid_response', result.error.message, null, response.status);
    }
    return result.data;
  }

  health(): Promise<Health> {
    return this.request('/health', healthSchema);
  }

  chains() {
    return this.request('/v1/chains', chainsResponseSchema);
  }

  account(agent: string): Promise<Account> {
    return this.request(`/v1/accounts/${agent}`, accountSchema);
  }

  executions() {
    return this.request('/v1/executions', executionsResponseSchema);
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export const api = new ApiClient(baseUrl);
