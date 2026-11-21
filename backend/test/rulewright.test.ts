import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import {
  emptyDraft,
  rulewrightRequestSchema,
  workflowV2Action,
  workflowV2Unit,
} from '@rulebook/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiConfig } from '../src/config.js';
import { generateRulewrightDraft, geminiTimeoutMs } from '../src/rulewright/gemini.js';

const db = new PGlite();
const origin = 'https://rulebook.example';
const wallet = '0x1111111111111111111111111111111111111111';

async function enqueue(session: string, audience = origin) {
  const response = await db.query<{ result: { status: string; id?: string } }>(
    'select rulewright_enqueue($1, $2, $3) as result',
    [session, audience, { prompt: 'Describe a schedule', followUps: [] }],
  );
  return response.rows[0]!.result;
}

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(
    readFileSync(new URL('../db/migrations/0016_rulewright.sql', import.meta.url), 'utf8'),
  );
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
      "insert into rulewright_sessions values ($1, $2, $3, $4, now() + interval '20 minutes')",
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
      has_function_privilege('anon', 'rulewright_claim()', 'execute') as anon,
      has_function_privilege('authenticated', 'rulewright_claim()', 'execute') as authenticated,
      has_function_privilege('service_role', 'rulewright_claim()', 'execute') as server`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, server: true });
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
});
