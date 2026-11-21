import {
  accountSchema,
  apiErrorSchema,
  chainsResponseSchema,
  executionsResponseSchema,
  healthSchema,
  leaderboardResponseSchema,
  listingsResponseSchema,
  proofSchema,
  ruleDetailResponseSchema,
  rulesResponseSchema,
  rulewrightChallengeSchema,
  rulewrightJobIdSchema,
  rulewrightJobSchema,
  rulewrightSessionSchema,
  sponsorStatusSchema,
  telegramAvailabilitySchema,
  telegramChallengeSchema,
  telegramPairingSchema,
  telegramSettingsSchema,
  type Account,
  type Health,
  type LeaderboardResponse,
  type Proof,
  type Rule,
  type RulewrightRequest,
  type SponsorStatus,
  type TelegramChallenge,
  type TelegramDefault,
  type TelegramPreference,
} from '@rulebook/shared';
import { z } from 'zod';

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
    baseUrl = this.baseUrl,
  ): Promise<T> {
    // Native `fetch` must be invoked with the global receiver in browsers; calling it as
    // `this.fetchImpl(...)` throws "Illegal invocation".
    const response = await this.fetchImpl.call(globalThis, `${baseUrl}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(10_000),
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

  rulewrightAvailability(signal?: AbortSignal) {
    return this.request('/v2/rulewright/availability', z.object({ available: z.boolean() }), {
      signal,
    });
  }

  rulewrightChallenge(owner: string, signal: AbortSignal) {
    return this.request(
      '/v2/rulewright/challenge',
      rulewrightChallengeSchema,
      rulewrightRequest('POST', signal, { owner }),
    );
  }

  rulewrightSession(nonce: string, signature: string, signal: AbortSignal) {
    return this.request(
      '/v2/rulewright/session',
      rulewrightSessionSchema,
      rulewrightRequest('POST', signal, { nonce, signature }),
    );
  }

  rulewrightEnqueue(input: RulewrightRequest, token: string, signal: AbortSignal) {
    return this.request(
      '/v2/rulewright/jobs',
      z.object({ id: rulewrightJobIdSchema }),
      rulewrightRequest('POST', signal, input, token),
    );
  }

  rulewrightJob(id: string, token: string, signal: AbortSignal) {
    return this.request(
      `/v2/rulewright/jobs/${encodeURIComponent(id)}`,
      rulewrightJobSchema,
      rulewrightRequest('GET', signal, undefined, token),
    );
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

  rules(agent: string, status: 'active' | 'paused' | 'cancelled' | 'all' = 'all'): Promise<Rule[]> {
    return this.rulesFeed(agent, status).then((response) => response.rules);
  }

  /** Rules plus their alert activity rows, for the lists that show both. */
  rulesFeed(agent: string, status: 'active' | 'paused' | 'cancelled' | 'all' = 'all') {
    return this.request(`/v1/accounts/${agent}/rules?status=${status}`, rulesResponseSchema);
  }

  ruleDetail(agent: string, ruleId: string) {
    return this.request(`/v1/accounts/${agent}/rules/${ruleId}`, ruleDetailResponseSchema);
  }

  marketplace(
    query: {
      template?: number;
      sort?: 'newest' | 'runs' | 'success_rate';
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<z.infer<typeof listingsResponseSchema>> {
    const params = new URLSearchParams();
    if (query.template !== undefined) params.set('template', String(query.template));
    if (query.sort) params.set('sort', query.sort);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.request(`/v1/marketplace${suffix}`, listingsResponseSchema);
  }

  leaderboard(limit = 50): Promise<LeaderboardResponse> {
    return this.request(`/v1/leaderboard?limit=${limit}`, leaderboardResponseSchema);
  }

  sponsor(agent: string): Promise<SponsorStatus> {
    return this.request(`/v1/sponsor/${agent}`, sponsorStatusSchema);
  }

  telegramAvailability(workflow = false) {
    return this.request(
      workflow ? '/v1/telegram/availability?workflow=true' : '/v1/telegram/availability',
      telegramAvailabilitySchema,
      undefined,
      '',
    );
  }

  private telegramRequest<T>(
    agent: string,
    suffix: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    method = 'GET',
    body?: object,
    signal?: AbortSignal,
  ) {
    const init = jsonRequest(method, undefined, body);
    if (signal) init.signal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    return this.request(`/v1/accounts/${agent.toLowerCase()}/telegram${suffix}`, schema, init, '');
  }

  telegramChallenge(agent: string, owner: string) {
    return this.telegramRequest(agent, '/challenge', telegramChallengeSchema, 'POST', {
      owner,
      browser: true,
    });
  }

  telegramSession(agent: string, owner: string, challenge: TelegramChallenge, signature: string) {
    return this.telegramRequest(
      agent,
      '/session',
      z.object({ verified: z.literal(true) }),
      'POST',
      {
        owner,
        challenge,
        signature,
      },
    );
  }

  telegramForgetBrowser(agent: string) {
    return this.telegramRequest(
      agent,
      '/session',
      z.object({ forgotten: z.literal(true) }),
      'DELETE',
    );
  }

  telegramSettings(agent: string, signal?: AbortSignal) {
    return this.telegramRequest(agent, '', telegramSettingsSchema, 'GET', undefined, signal);
  }

  telegramPair(agent: string) {
    return this.telegramRequest(agent, '/pairing', telegramPairingSchema, 'POST');
  }

  telegramConfirm(agent: string, pairingId: string) {
    return this.telegramRequest(agent, '/pairing/confirm', telegramSettingsSchema, 'POST', {
      pairingId,
    });
  }

  telegramPreferences(
    agent: string,
    preference:
      | { enabled?: boolean; defaultMode?: TelegramDefault }
      | { fundingAlerts?: boolean; actionAlerts?: boolean }
      | { ruleId: string; preference: TelegramPreference }
      | { workflowId: string; preference: TelegramPreference },
  ) {
    return this.telegramRequest(agent, '/preferences', telegramSettingsSchema, 'PATCH', preference);
  }

  telegramDisconnect(agent: string) {
    return this.telegramRequest(agent, '/connection', telegramSettingsSchema, 'DELETE');
  }

  telegramTest(agent: string) {
    return this.telegramRequest(agent, '/test', telegramSettingsSchema, 'POST');
  }

  proof(reactiveTxHash: string): Promise<Proof> {
    return this.request(
      `/v1/proofs/${encodeURIComponent(reactiveTxHash)}?include=mirrors`,
      proofSchema,
    );
  }
}

function jsonRequest(method: string, token?: string, body?: object): RequestInit {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' };
}

function rulewrightRequest(
  method: string,
  signal: AbortSignal,
  body?: object,
  token?: string,
): RequestInit {
  const request = jsonRequest(method, token, body);
  return {
    ...request,
    headers: { ...request.headers, 'x-rulewright-origin': window.location.origin },
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
  };
}

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

export const api = new ApiClient(apiBaseUrl);
