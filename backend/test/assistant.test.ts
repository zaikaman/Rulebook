import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  UNICHAIN_MAINNET_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowDeploymentKey,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import type { Address, Hex } from 'viem';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeminiConfig } from '../src/config.js';
import { runAssistantTurn } from '../src/assistant/provider.js';
import { registerAssistantRoutes } from '../src/assistant/routes.js';
import { AssistantService } from '../src/assistant/service.js';
import { AssistantToolExecutor } from '../src/assistant/tools.js';

const db = new PGlite();
const origin = 'https://rulebook.example';
const wallet = '0x1111111111111111111111111111111111111111';
const otherWallet = '0x9999999999999999999999999999999999999999';

interface Admission {
  status: 'ok' | 'unauthorized' | 'limited' | 'missing';
  owner?: string;
  conversation?: string;
  history?: { role: string; content: string }[];
}

async function admit(
  session = 'token-hash',
  audience = origin,
  conversation: string | null = null,
  message = 'What needs attention?',
) {
  const { rows } = await db.query<{ result: Admission }>(
    'select assistant_admit($1, $2, $3, $4) as result',
    [session, audience, conversation, message],
  );
  return rows[0]!.result;
}

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(
    readFileSync(new URL('../db/migrations/0021_assistant.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    readFileSync(
      new URL('../db/migrations/0022_assistant_persistent_sessions.sql', import.meta.url),
      'utf8',
    ),
  );
});

afterAll(async () => db.close());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('assistant admission', () => {
  beforeEach(async () => {
    await db.exec(
      'truncate assistant_sessions, assistant_conversations, assistant_messages restart identity cascade',
    );
    await db.query("insert into assistant_sessions values ('nonce', $1, $2, 'token-hash', null)", [
      wallet,
      origin,
    ]);
  });

  it('requires a current wallet session and matching origin', async () => {
    expect(await admit('missing')).toEqual({ status: 'unauthorized' });
    expect(await admit('token-hash', 'https://other.example')).toEqual({
      status: 'unauthorized',
    });
    await db.exec(
      "insert into assistant_sessions values ('expired', 'wallet', 'https://rulebook.example', 'expired', now())",
    );
    expect(await admit('expired')).toEqual({ status: 'unauthorized' });
    const opened = await admit();
    expect(opened.status).toBe('ok');
    expect(opened.owner).toBe(wallet);
    expect(opened.history).toEqual([]);
  });

  it('keeps permanent sessions while cleanup removes expired challenges', async () => {
    await db.exec(
      "insert into assistant_sessions values ('challenge-expired', 'wallet', 'https://rulebook.example', null, now() - interval '1 minute')",
    );
    await db.exec('select assistant_cleanup()');
    expect(await admit()).toMatchObject({ status: 'ok', owner: wallet });
    const { rows } = await db.query<{ count: string }>(
      "select count(*)::text as count from assistant_sessions where nonce = 'challenge-expired'",
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('keeps conversations scoped to the owner and returns prior turns', async () => {
    const first = await admit('token-hash', origin, null, 'First question');
    const conversation = first.conversation!;
    await db.query('select assistant_finish($1, $2, $3, null)', [
      conversation,
      wallet,
      'First answer',
    ]);
    const resumed = await admit('token-hash', origin, conversation, 'Second question');
    expect(resumed.history).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ]);

    await db.query('insert into assistant_conversations (owner, origin) values ($1, $2)', [
      otherWallet,
      origin,
    ]);
    const foreign = await db.query<{ id: string }>(
      'select id from assistant_conversations where owner = $1',
      [otherWallet],
    );
    expect(await admit('token-hash', origin, foreign.rows[0]!.id)).toEqual({ status: 'missing' });

    const finished = await db.query<{ done: boolean }>(
      'select assistant_finish($1, $2, $3, null) as done',
      [conversation, otherWallet, 'Should not save'],
    );
    expect(finished.rows[0]!.done).toBe(false);
  });

  it('caps the daily user-message quota per wallet', async () => {
    const opened = await admit();
    await db.query(
      `insert into assistant_messages (conversation_id, role, content)
        select $1, 'user', 'quota' from generate_series(1, 79)`,
      [opened.conversation],
    );
    expect((await admit()).status).toBe('limited');
  });

  it('grants session and conversation operations only to the backend role', async () => {
    const { rows } = await db.query<{
      anon: boolean;
      authenticated: boolean;
      server: boolean;
    }>(`select
      has_function_privilege('anon', 'assistant_admit(text,text,uuid,text)', 'execute') as anon,
      has_function_privilege('authenticated', 'assistant_admit(text,text,uuid,text)', 'execute') as authenticated,
      has_function_privilege('service_role', 'assistant_admit(text,text,uuid,text)', 'execute') as server`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, server: true });
  });
});

const provider: GeminiConfig = {
  model: 'test-model',
  endpoint: new URL('https://provider.example/chat/completions'),
  apiKey: 'test-key',
};

function streamResponse(frames: readonly object[]) {
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('assistant streaming tool loop', () => {
  it('accumulates fragmented tool arguments, executes the tool, and streams the answer', async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_input: unknown, init?: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) {
        return streamResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: { name: 'list_runs', arguments: '{"lim' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: 'it":2}' } }] },
                finish_reason: 'tool_calls',
              },
            ],
          },
        ]);
      }
      return streamResponse([
        {
          choices: [
            {
              delta: { content: 'Your last run was confirmed.' },
              finish_reason: 'stop',
            },
          ],
        },
      ]);
    });

    const deltas: string[] = [];
    const trace: { state: string; detail?: string }[] = [];
    const executed: { name: string; args: unknown }[] = [];
    const result = await runAssistantTurn({
      provider,
      messages: [{ role: 'user', content: 'What happened in my last run?' }],
      tools: [
        {
          name: 'list_runs',
          label: 'Reading your run history',
          description: 'Read runs.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      execute: async (name, args) => {
        executed.push({ name, args });
        return {
          content: '{"runs":[{"status":"confirmed"}]}',
          detail: '1 run',
          references: [
            { kind: 'activity', id: 'activity', label: 'Open Activity', href: '/activity' },
          ],
        };
      },
      onDelta: (delta) => deltas.push(delta),
      onTool: (event) => trace.push(event),
      signal: new AbortController().signal,
    });

    expect(executed).toEqual([{ name: 'list_runs', args: { limit: 2 } }]);
    expect(deltas.join('')).toBe('Your last run was confirmed.');
    expect(result.text).toBe('Your last run was confirmed.');
    expect(result.references).toHaveLength(1);
    expect(trace.map((event) => event.state)).toEqual(['start', 'done']);
    expect(trace[1]?.detail).toBe('1 run');
    expect(requests[0]?.tools).toHaveLength(1);
    expect((requests[1]?.messages as { role: string }[]).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ]);
    expect(
      (requests[1]?.messages as { role: string; tool_call_id?: string }[]).at(-1),
    ).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });

  it('returns an actionable failure when the provider is unavailable', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 503 }));
    await expect(
      runAssistantTurn({
        provider,
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        execute: async () => ({ content: '{}', detail: '', references: [] }),
        onDelta: () => undefined,
        onTool: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ failure: 'unavailable' });
  });
});

describe('assistant data tools', () => {
  it('scopes run history to the session owner and the configured deployment', async () => {
    const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
    const runId = `0x${'1'.repeat(64)}`;
    const workflowId = `0x${'2'.repeat(64)}`;
    const hash = `0x${'3'.repeat(64)}`;
    const requests: URL[] = [];
    const row = {
      id: runId,
      workflow_id: workflowId,
      title: 'Recurring transfer',
      status: 'confirmed',
      reason: null,
      path: 1,
      origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
      origin_transaction: hash,
      lasna_transaction: hash,
      destination_transaction: hash,
      lasna_block: 10,
      expires_at: 100,
    };
    const client = createClient('https://database.example', 'fixture-key', {
      global: {
        fetch: async (input) => {
          requests.push(new URL(String(input)));
          return Response.json([row]);
        },
      },
    });
    const deployment = {
      lasna: { factory: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const, startBlock: 1 },
      unichain: { factory: '0xcccccccccccccccccccccccccccccccccccccccc' as const, startBlock: 1 },
    };
    const executor = new AssistantToolExecutor(client, {} as never, deployment, owner);
    const result = await executor.execute('list_runs', { limit: 3, workflowId });

    expect(requests[0]?.searchParams.get('owner')).toBe(`eq.${owner}`);
    expect(requests[0]?.searchParams.get('deployment')).toBe(
      `eq.${workflowDeploymentKey(LASNA_CHAIN_ID, deployment.lasna.factory)}`,
    );
    expect(requests[0]?.searchParams.get('workflow_id')).toBe(`eq.${workflowId}`);
    expect(result.detail).toBe('1 run');
    expect(result.content).toContain('"title":"Recurring transfer"');
    expect(result.references.map((reference) => reference.kind)).toEqual(['run', 'activity']);
  });

  it('aggregates Unichain Sepolia and Base Sepolia vaults and credits in get_account_overview', async () => {
    const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
    const agent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const uniVault = '0x1111111111111111111111111111111111111111' as const;
    const baseVault = '0x2222222222222222222222222222222222222222' as const;
    const deployment = {
      lasna: { factory: '0x3333333333333333333333333333333333333333' as const, startBlock: 1 },
      unichain: { factory: '0x4444444444444444444444444444444444444444' as const, startBlock: 1 },
      base: { factory: '0x5555555555555555555555555555555555555555' as const, startBlock: 1 },
    };
    const mkClient = (vault: Address, usdcBalance: bigint) => ({
      getBalance: async () => 500_000_000_000_000_000n,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'agentOf') return agent;
        if (functionName === 'vaultOf') return vault;
        if (functionName === 'callbackProxy') return '0x6666666666666666666666666666666666666666';
        if (functionName === 'balanceOf') return usdcBalance;
        if (functionName === 'allowance') return 2_000_000n;
        if (functionName === 'reserves') return 100_000_000_000_000_000n;
        return 0n;
      },
    });
    const clients = {
      lasna: mkClient(agent, 0n),
      unichain: mkClient(uniVault, 10_000_000n),
      base: mkClient(baseVault, 25_000_000n),
    };
    const executor = new AssistantToolExecutor({} as never, clients as never, deployment, owner);
    const overview = await executor.execute('get_account_overview', {});
    const parsed = JSON.parse(overview.content) as {
      vaults: Record<string, { name: string; vault: string; vaultUsdc: string }>;
      networks: { allFundsChains: { chain: number; name: string }[] };
    };
    expect(parsed.vaults[String(UNICHAIN_SEPOLIA_CHAIN_ID)]).toMatchObject({
      name: 'Unichain Sepolia',
      vault: uniVault,
      vaultUsdc: '10',
    });
    expect(parsed.vaults[String(BASE_SEPOLIA_CHAIN_ID)]).toMatchObject({
      name: 'Base Sepolia',
      vault: baseVault,
      vaultUsdc: '25',
    });
    expect(parsed.networks.allFundsChains.map((c) => c.chain)).toEqual([
      UNICHAIN_SEPOLIA_CHAIN_ID,
      BASE_SEPOLIA_CHAIN_ID,
    ]);
  });

  it('supports Mainnet mode in AssistantToolExecutor and scopes SQL & references to Mainnet', async () => {
    const owner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;
    const agent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const uniVault = '0x1111111111111111111111111111111111111111' as const;
    const baseVault = '0x2222222222222222222222222222222222222222' as const;
    const deployment = {
      reactive: { factory: '0x3333333333333333333333333333333333333333' as const, startBlock: 1 },
      unichain: { factory: '0x4444444444444444444444444444444444444444' as const, startBlock: 1 },
      base: { factory: '0x5555555555555555555555555555555555555555' as const, startBlock: 1 },
    };
    const mkClient = (vault: Address, usdcBalance: bigint) => ({
      getBalance: async () => 1_000_000_000_000_000_000n,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'agentOf') return agent;
        if (functionName === 'vaultOf') return vault;
        if (functionName === 'callbackProxy') return '0x6666666666666666666666666666666666666666';
        if (functionName === 'balanceOf') return usdcBalance;
        if (functionName === 'allowance') return 2_000_000n;
        if (functionName === 'reserves') return 500_000_000_000_000_000n;
        return 0n;
      },
    });
    const requests: URL[] = [];
    const runId = `0x${'7'.repeat(64)}`;
    const workflowId = `0x${'8'.repeat(64)}`;
    const hash = `0x${'9'.repeat(64)}`;
    const client = createClient('https://database.example', 'fixture-key', {
      global: {
        fetch: async (input) => {
          const url = new URL(String(input));
          requests.push(url);
          if (url.pathname.endsWith('/workflow_v2_activity')) {
            return Response.json([
              {
                id: runId,
                workflow_id: workflowId,
                chain: UNICHAIN_MAINNET_CHAIN_ID,
                title: 'Mainnet DCA',
                status: 'confirmed',
                reason: null,
                path: 0,
                origin_chain: BASE_MAINNET_CHAIN_ID,
                origin_transaction: hash,
                lasna_transaction: hash,
                destination_transaction: hash,
                lasna_block: 42,
                expires_at: 999,
              },
            ]);
          }
          if (url.pathname.endsWith('/telegram_accounts')) {
            return Response.json({
              chat_id: '123',
              profile: 'Mainnet',
              blocked: false,
              enabled: true,
              default_mode: 'all',
            });
          }
          return Response.json([]);
        },
      },
    });
    const clients = {
      lasna: { getBalance: vi.fn(), readContract: vi.fn() },
      unichain: { getBalance: vi.fn(), readContract: vi.fn() },
      reactiveMainnet: mkClient(agent, 0n),
      unichainMainnet: mkClient(uniVault, 42_000_000n),
      baseMainnet: mkClient(baseVault, 15_000_000n),
    };
    const executor = new AssistantToolExecutor(client, clients as never, deployment, owner);
    const overview = await executor.execute('get_account_overview', {});
    const parsed = JSON.parse(overview.content) as {
      network: string;
      networks: { automation: { name: string }; allFundsChains: { chain: number }[] };
      vaults: Record<string, { vaultUsdc: string }>;
    };
    expect(parsed.network).toBe('mainnet');
    expect(parsed.networks.automation.name).toBe('Reactive Mainnet');
    expect(parsed.networks.allFundsChains.map((c) => c.chain)).toEqual([
      UNICHAIN_MAINNET_CHAIN_ID,
      BASE_MAINNET_CHAIN_ID,
    ]);
    expect(parsed.vaults[String(UNICHAIN_MAINNET_CHAIN_ID)]?.vaultUsdc).toBe('42');
    expect(overview.references[0]?.href).toBe('/account?network=mainnet');
    expect(clients.lasna.readContract).not.toHaveBeenCalled();

    const runs = await executor.execute('list_runs', { limit: 1 });
    expect(requests[0]?.searchParams.get('deployment')).toBe(
      `eq.${workflowDeploymentKey(REACTIVE_MAINNET_CHAIN_ID, deployment.reactive.factory)}`,
    );
    expect(runs.references.map((r) => r.href)).toEqual([
      `/runs/${runId}?network=mainnet`,
      '/activity?network=mainnet',
    ]);

    await executor.execute('get_notifications', {});
    const telegramReq = requests.find((u) => u.pathname.endsWith('/telegram_accounts'));
    expect(telegramReq?.searchParams.get('automation_chain')).toBe(
      `eq.${REACTIVE_MAINNET_CHAIN_ID}`,
    );
  });

  it('supports mainnet-only AssistantService, per-mode availability, and symmetric ERC-1271 signIn', async () => {
    const mainnetDeployment = {
      reactive: { factory: '0x3333333333333333333333333333333333333333' as const, startBlock: 1 },
      unichain: { factory: '0x4444444444444444444444444444444444444444' as const, startBlock: 1 },
    };
    const expiresAtIso = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000).toISOString();
    const challengeRow = {
      nonce: `0x${'1'.repeat(64)}`,
      owner: wallet,
      origin,
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
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => selectChain),
      })),
    } as never;
    const clients = {
      lasna: { verifyMessage: vi.fn().mockResolvedValue(false) },
      unichain: {},
      reactiveMainnet: { verifyMessage: vi.fn().mockRejectedValue(new Error('rpc down')) },
    } as never;
    const service = new AssistantService(
      supabase,
      clients,
      { mainnet: mainnetDeployment },
      provider,
    );
    await expect(service.ready('mainnet')).resolves.toBe(true);
    await expect(service.ready('testnet')).resolves.toBe(false);

    // Dual-mode service: flaky reactiveMainnet RPC does not throw 500 when lasna evaluates invalid signature to false.
    const dualService = new AssistantService(
      supabase,
      clients,
      {
        testnet: {
          lasna: { factory: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', startBlock: 1 },
          unichain: { factory: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', startBlock: 1 },
        },
        mainnet: mainnetDeployment,
      },
      provider,
    );
    await expect(
      dualService.signIn(`0x${'1'.repeat(64)}` as Hex, origin, '0x1234' as Hex),
    ).resolves.toBeNull();

    const app = Fastify();
    registerAssistantRoutes(app, {
      config: { corsOrigins: [origin] } as never,
      assistant: service,
      databaseReachable: async () => true,
      rpcHealth: async () => [],
    });
    expect(
      (
        await app.inject({ method: 'GET', url: '/v2/assistant/availability?network=testnet' })
      ).json(),
    ).toEqual({ available: false });
    expect(
      (
        await app.inject({ method: 'GET', url: '/v2/assistant/availability?network=mainnet' })
      ).json(),
    ).toEqual({ available: true });
    await app.close();
  });
});
