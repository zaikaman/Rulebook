import {
  accountSchema,
  apiErrorSchema,
  chainsResponseSchema,
  executionsResponseSchema,
  healthSchema,
  onboardingResponseSchema,
  ruleDetailResponseSchema,
  rulesResponseSchema,
  starterFundsResponseSchema,
  type Account,
  type Address,
  type Health,
  type OnboardingResponse,
  type Rule,
  type StarterFundsResponse,
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
    // Native `fetch` must be invoked with the global receiver in browsers; calling it as
    // `this.fetchImpl(...)` throws "Illegal invocation".
    const response = await this.fetchImpl.call(globalThis, `${this.baseUrl}${path}`, {
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

  onboarding(owner: Address): Promise<OnboardingResponse> {
    return this.request('/v1/onboarding', onboardingResponseSchema, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner }),
    });
  }

  starterFunds(owner: Address, vault: Address): Promise<StarterFundsResponse> {
    return this.request('/v1/starter-funds', starterFundsResponseSchema, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner, vault }),
    });
  }

  executions() {
    return this.request('/v1/executions', executionsResponseSchema);
  }

  rules(agent: string, status: 'active' | 'paused' | 'cancelled' | 'all' = 'all'): Promise<Rule[]> {
    return this.request(
      `/v1/accounts/${agent}/rules?status=${status}`,
      rulesResponseSchema,
    ).then((response) => response.rules);
  }

  ruleDetail(agent: string, ruleId: string) {
    return this.request(
      `/v1/accounts/${agent}/rules/${ruleId}`,
      ruleDetailResponseSchema,
    );
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export const api = new ApiClient(baseUrl);
