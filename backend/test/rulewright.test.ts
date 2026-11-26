import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  encodeWorkflowV2,
  emptyDraft,
  getChain,
  rulewrightRequestSchema,
  toProgram,
  workflowV2Action,
  workflowV2Trigger,
  workflowV2Unit,
} from '@rulebook/shared';
import type { Hex } from 'viem';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiConfig } from '../src/config.js';
import { generateRulewrightDraft, geminiTimeoutMs } from '../src/rulewright/gemini.js';
import { RulewrightService } from '../src/rulewright/service.js';

const db = new PGlite();
const origin = 'https://rulebook.example';
const wallet = '0x1111111111111111111111111111111111111111';

async function enqueue(
  session: string,
  audience = origin,
  network: 'testnet' | 'mainnet' = 'testnet',
) {
  const response = await db.query<{ result: { status: string; id?: string } }>(
    'select rulewright_enqueue($1, $2, $3, $4) as result',
    [session, audience, { prompt: 'Describe a schedule', followUps: [] }, network],
  );
  return response.rows[0]!.result;
}

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
});

afterAll(async () => db.close());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Rulewright job queue', () => {
  beforeEach(async () => {
    await db.exec('truncate rulewright_sessions, rulewright_jobs');
    await db.query(
      "insert into rulewright_sessions (nonce, owner, origin, token_hash, expires_at, network) values ($1, $2, $3, $4, now() + interval '20 minutes', 'testnet')",
      ['nonce', wallet, origin, 'token-hash'],
    );
  });

  it('scopes job admission to a current wallet session and frontend origin', async () => {
    expect(await enqueue('missing')).toEqual({ status: 'unauthorized' });
    expect(await enqueue('token-hash', 'https://other.example')).toEqual({
      status: 'unauthorized',
    });
    await db.exec(
      "insert into rulewright_sessions values ('expired', 'wallet', 'https://rulebook.example', 'expired', now())",
    );
    expect(await enqueue('expired')).toEqual({ status: 'unauthorized' });
    expect(await enqueue('token-hash', origin, 'mainnet')).toEqual({ status: 'unauthorized' });
    expect((await enqueue('token-hash')).status).toBe('queued');
  });

  it('leases a job to one worker and recovers it once after a restart', async () => {
    expect((await enqueue('token-hash')).status).toBe('queued');
    const first = await db.query<{ id: string; lease: string }>('select * from rulewright_claim()');
    const [{ id, lease }] = first.rows as [{ id: string; lease: string }];
    expect((await db.query('select * from rulewright_claim()')).rows).toHaveLength(0);
    await db.query('update rulewright_jobs set lease_expires_at = now() where id = $1', [id]);
    const retried = await db.query<{ id: string; lease: string }>(
      'select * from rulewright_claim()',
    );
    expect(retried.rows[0]?.id).toBe(id);
    expect(retried.rows[0]?.lease).not.toBe(lease);
    await db.query('update rulewright_jobs set lease_expires_at = now() where id = $1', [id]);
    await db.query('select rulewright_cleanup()');
    expect((await db.query('select * from rulewright_claim()')).rows).toHaveLength(0);
    const data = await db.query('select payload, result from rulewright_jobs where id = $1', [id]);
    expect(data.rows[0]).toMatchObject({ payload: null, result: { type: 'error' } });
  });

  it('enforces daily quotas and retains only an admission record after expiry', async () => {
    await db.query(
      'insert into rulewright_jobs (owner, session_hash) select $1, $2 from generate_series(1, 20)',
      [wallet, 'token-hash'],
    );
    expect(await enqueue('token-hash')).toEqual({ status: 'limited' });
    await db.exec(
      "update rulewright_jobs set expires_at = now() - interval '1 minute', result = '{}'::jsonb",
    );
    await db.query('select rulewright_cleanup()');
    expect(
      (
        await db.query(
          'select result, payload from rulewright_jobs where result is not null or payload is not null',
        )
      ).rows,
    ).toHaveLength(0);
    expect(await enqueue('token-hash')).toEqual({ status: 'limited' });
  });

  it('grants queue operations only to the backend role', async () => {
    const { rows } = await db.query(`select
      has_function_privilege('anon', 'rulewright_claim()', 'execute') as claim_anon,
      has_function_privilege('authenticated', 'rulewright_claim()', 'execute') as claim_authenticated,
      has_function_privilege('service_role', 'rulewright_claim()', 'execute') as claim_server,
      has_function_privilege('anon', 'rulewright_enqueue(text,text,jsonb,text)', 'execute') as enqueue_anon,
      has_function_privilege('authenticated', 'rulewright_enqueue(text,text,jsonb,text)', 'execute') as enqueue_authenticated,
      has_function_privilege('service_role', 'rulewright_enqueue(text,text,jsonb,text)', 'execute') as enqueue_server`);
    expect(rows[0]).toEqual({
      claim_anon: false,
      claim_authenticated: false,
      claim_server: true,
      enqueue_anon: false,
      enqueue_authenticated: false,
      enqueue_server: true,
    });
  });
});

describe('Gemini request handling', () => {
  const provider: GeminiConfig = {
    model: 'test-model',
    endpoint: new URL('https://provider.example/chat/completions'),
    apiKey: 'test-key',
  };
  const request = { prompt: 'Alert every hour', followUps: [] };

  it('uses a 60 second deadline and returns an actionable timeout', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.stubGlobal('fetch', async () => {
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
      throw controller.signal.reason;
    });
    const validate = vi.fn();
    await expect(
      generateRulewrightDraft(provider, request, validate, new AbortController().signal),
    ).resolves.toEqual({ type: 'error', message: 'Gemini timed out after 60 seconds. Try again.' });
    expect(timeout).toHaveBeenCalledWith(geminiTimeoutMs);
    expect(geminiTimeoutMs).toBe(60_000);
    expect(validate).not.toHaveBeenCalled();
  });

  it.each([
    ['Buy 2 USDC of WETH every six hours.', '10', 'per-run USDC cap'],
    [
      'Buy 2 USDC of WETH every six hours with a per-run cap of 10 USDC.',
      '10',
      'maximum swap slippage',
    ],
    ['Buy 2 USDC of WETH every 6 hours. Limit slippage to 0.5%.', '6', 'per-run USDC cap'],
    [
      'Buy 2 USDC of WETH every 6 hours. Use a 10 WETH spending cap and slippage of 0.5%.',
      '10',
      'per-run USDC cap',
    ],
  ])('asks for a guardrail even if Gemini supplies one for %s', async (prompt, cap, missing) => {
    const completion = {
      type: 'draft',
      message: '',
      settings: [
        { field: 'title', value: 'Scheduled buy' },
        { field: 'interval', value: '21600' },
        { field: 'usdcCap', value: cap },
        { field: 'slippage', value: '0.5' },
      ],
      nodes: [
        {
          path: '',
          check: 0,
          value: '',
          upper: '',
          steps: [
            { kind: workflowV2Action.buy, unit: workflowV2Unit.fixed, amount: '2', recipient: '' },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', async () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(completion) } }],
      }),
    );
    const validate = vi.fn();
    const result = await generateRulewrightDraft(
      provider,
      { prompt, followUps: [] },
      validate,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ type: 'question', message: expect.stringContaining(missing) });
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects deeply nested malformed drafts without recursing into them', () => {
    let root: unknown = { steps: [] };
    for (let depth = 0; depth < 2000; depth += 1) root = { check: 1, yes: root };
    const result = rulewrightRequestSchema.safeParse({
      ...request,
      draft: { ...emptyDraft(), root },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a truncated provider response before validation', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    );
    const validate = vi.fn();
    await expect(
      generateRulewrightDraft(provider, request, validate, new AbortController().signal),
    ).resolves.toMatchObject({ type: 'error' });
    expect(validate).not.toHaveBeenCalled();
  });

  it('supports Base Sepolia chain switching and cross-chain origin triggers', async () => {
    const baseUsdc = getChain(BASE_SEPOLIA_CHAIN_ID).usdc;
    const completion = {
      type: 'draft',
      message: '',
      settings: [
        { field: 'title', value: 'Base transfer alert' },
        { field: 'chain', value: String(UNICHAIN_SEPOLIA_CHAIN_ID) },
        { field: 'originChain', value: String(BASE_SEPOLIA_CHAIN_ID) },
        { field: 'trigger', value: String(workflowV2Trigger.transfer) },
        { field: 'source', value: baseUsdc },
        { field: 'subject', value: wallet },
        { field: 'once', value: 'true' },
      ],
      nodes: [
        {
          path: '',
          check: 0,
          value: '',
          upper: '',
          steps: [
            { kind: workflowV2Action.alert, unit: workflowV2Unit.fixed, amount: '', recipient: '' },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', async () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(completion) } }],
      }),
    );
    const validate = vi.fn().mockResolvedValue(true);
    const result = await generateRulewrightDraft(
      provider,
      {
        prompt: `Watch ${baseUsdc} transfers from ${wallet} on Base Sepolia and alert on Unichain`,
        followUps: [],
      },
      validate,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      type: 'draft',
      draft: {
        chain: UNICHAIN_SEPOLIA_CHAIN_ID,
        originChain: BASE_SEPOLIA_CHAIN_ID,
        trigger: workflowV2Trigger.transfer,
      },
    });
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('rejects unconfigured mainnet requests before enqueue/quota and isolates ERC-1271 signIn per environment', async () => {
    const rpc = vi.fn();
    const expiresAtIso = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000).toISOString();
    const challengeRow = {
      nonce: `0x${'1'.repeat(64)}`,
      owner: wallet,
      origin,
      network: 'mainnet',
      expires_at: expiresAtIso,
    };
    const selectChain = {
      limit: vi.fn(() => ({ abortSignal: vi.fn(async () => ({ error: null })) })),
      eq: vi.fn(),
      is: vi.fn(),
      gt: vi.fn(),
      abortSignal: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: challengeRow, error: null })),
    };
    selectChain.eq.mockReturnValue(selectChain);
    selectChain.is.mockReturnValue(selectChain);
    selectChain.gt.mockReturnValue(selectChain);
    selectChain.abortSignal.mockReturnValue(selectChain);
    const mockSupabase = {
      rpc,
      from: vi.fn(() => ({
        select: vi.fn(() => selectChain),
      })),
    } as never;
    const clients = {
      lasna: { verifyMessage: vi.fn().mockResolvedValue(true) },
      unichain: {},
      reactiveMainnet: { verifyMessage: vi.fn().mockResolvedValue(false) },
    } as never;

    const service = new RulewrightService(
      mockSupabase,
      clients,
      { [UNICHAIN_SEPOLIA_CHAIN_ID]: '0x1111111111111111111111111111111111111111' },
      provider,
    );

    await expect(service.ready('testnet')).resolves.toBe(true);
    await expect(service.ready('mainnet')).resolves.toBe(false);

    const admission = await service.enqueue('t'.repeat(43), origin, {
      prompt: 'Buy 10 USDC of WETH daily',
      network: 'mainnet',
      followUps: [],
    });
    expect(admission).toEqual({ status: 'network_unavailable', network: 'mainnet' });
    expect(rpc).not.toHaveBeenCalled();

    const draftAdmission = await service.enqueue('t'.repeat(43), origin, {
      prompt: 'Update draft',
      draft: emptyDraft(UNICHAIN_MAINNET_CHAIN_ID),
      followUps: [],
    });
    expect(draftAdmission).toEqual({ status: 'network_unavailable', network: 'mainnet' });
    await expect(
      service.enqueue('t'.repeat(43), origin, {
        prompt: 'Mismatched draft',
        network: 'testnet',
        draft: emptyDraft(UNICHAIN_MAINNET_CHAIN_ID),
        followUps: [],
      }),
    ).rejects.toThrow(/does not match/);
    const mixedOrigin = {
      prompt: 'Mismatched origin chain',
      draft: { ...emptyDraft(UNICHAIN_SEPOLIA_CHAIN_ID), originChain: BASE_MAINNET_CHAIN_ID },
      followUps: [],
    };
    expect(rulewrightRequestSchema.safeParse(mixedOrigin).success).toBe(false);
    await expect(service.enqueue('t'.repeat(43), origin, mixedOrigin)).rejects.toThrow(
      /same network mode/,
    );
    await expect(
      service.enqueue('t'.repeat(43), origin, { ...mixedOrigin, network: 'testnet' }),
    ).rejects.toThrow(/same network mode/);
    expect(rpc).not.toHaveBeenCalled();

    const dualService = new RulewrightService(
      mockSupabase,
      clients,
      {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: '0x1111111111111111111111111111111111111111',
        [UNICHAIN_MAINNET_CHAIN_ID]: '0x2222222222222222222222222222222222222222',
      },
      provider,
    );
    await expect(
      dualService.signIn(`0x${'1'.repeat(64)}` as Hex, origin, '0x1234' as Hex),
    ).resolves.toBeNull();
    expect(clients.lasna.verifyMessage).not.toHaveBeenCalled();
    expect(clients.reactiveMainnet.verifyMessage).toHaveBeenCalledTimes(1);
  });

  it('persists resolved network into p_payload, enforces it in Gemini, and blocks cross-env on-chain validation', async () => {
    const rpc = vi.fn(() => ({
      abortSignal: vi.fn(async () => ({
        data: { status: 'queued', id: crypto.randomUUID() },
        error: null,
      })),
    }));
    const mockSupabase = { rpc } as never;
    const testnetRead = vi.fn();
    const mainnetRead = vi.fn();
    const clients = {
      unichain: { readContract: testnetRead },
      baseSepolia: { readContract: testnetRead },
      unichainMainnet: { readContract: mainnetRead },
      baseMainnet: { readContract: mainnetRead },
    } as never;

    const dualService = new RulewrightService(
      mockSupabase,
      clients,
      {
        [UNICHAIN_SEPOLIA_CHAIN_ID]: '0x1111111111111111111111111111111111111111',
        [UNICHAIN_MAINNET_CHAIN_ID]: '0x2222222222222222222222222222222222222222',
      },
      provider,
    );

    // 1. Omitted network defaults to testnet and persists network: 'testnet' in p_payload.
    await dualService.enqueue('t'.repeat(43), origin, {
      prompt: 'Alert every hour',
      followUps: [],
    });
    expect(rpc).toHaveBeenLastCalledWith('rulewright_enqueue', {
      p_session: expect.any(String),
      p_origin: origin,
      p_payload: { prompt: 'Alert every hour', followUps: [], network: 'testnet' },
      p_network: 'testnet',
    });

    // 2. Mainnet draft with omitted network resolves and persists network: 'mainnet'.
    const mainnetDraft = emptyDraft(UNICHAIN_MAINNET_CHAIN_ID);
    await dualService.enqueue('t'.repeat(43), origin, {
      prompt: 'Update draft',
      draft: mainnetDraft,
      followUps: [],
    });
    expect(rpc).toHaveBeenLastCalledWith('rulewright_enqueue', {
      p_session: expect.any(String),
      p_origin: origin,
      p_payload: { prompt: 'Update draft', draft: mainnetDraft, followUps: [], network: 'mainnet' },
      p_network: 'mainnet',
    });

    // 3. Even if network is omitted in generateRulewrightDraft(), Gemini receives testnet guidance
    //    and any patch targeting Mainnet chains (130 / 8453) is rejected before validate().
    let sentSystemPrompt = '';
    const mainnetPatch = {
      type: 'draft',
      message: '',
      settings: [
        { field: 'title', value: 'Sneaky mainnet alert' },
        { field: 'chain', value: String(UNICHAIN_MAINNET_CHAIN_ID) },
        { field: 'originChain', value: String(BASE_MAINNET_CHAIN_ID) },
        { field: 'interval', value: '3600' },
      ],
      nodes: [
        {
          path: '',
          check: 0,
          value: '',
          upper: '',
          steps: [
            { kind: workflowV2Action.alert, unit: workflowV2Unit.fixed, amount: '', recipient: '' },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}');
      sentSystemPrompt = body.messages?.[0]?.content ?? '';
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(mainnetPatch) } }],
      });
    });
    const validate = vi.fn();
    const geminiResult = await generateRulewrightDraft(
      provider,
      { prompt: 'Alert on mainnet every hour', followUps: [] },
      validate,
      new AbortController().signal,
    );
    expect(sentSystemPrompt).toContain('Target network mode: testnet.');
    expect(geminiResult).toMatchObject({
      type: 'question',
      message: expect.stringContaining('Keep chains in testnet'),
    });
    expect(validate).not.toHaveBeenCalled();

    // 4. validateOnChain rejects encoded Mainnet program under a testnet session without touching mainnet RPC.
    const mainnetEncoded = encodeWorkflowV2(
      toProgram({
        ...emptyDraft(UNICHAIN_MAINNET_CHAIN_ID),
        title: 'Mainnet alert',
        interval: '3600',
        root: {
          steps: [
            { kind: workflowV2Action.alert, unit: workflowV2Unit.fixed, amount: '', recipient: '' },
          ],
        },
      }),
    );
    await expect(
      (
        dualService as unknown as {
          validateOnChain: (encoded: Hex, targetNetwork: 'testnet' | 'mainnet') => Promise<void>;
        }
      ).validateOnChain(mainnetEncoded, 'testnet'),
    ).rejects.toThrow(/do not match testnet/);
    expect(mainnetRead).not.toHaveBeenCalled();
    expect(testnetRead).not.toHaveBeenCalled();
  });
});
