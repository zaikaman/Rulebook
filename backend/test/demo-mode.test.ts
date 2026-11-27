import {
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  assistantDemoSessionSchema,
  demoAccountConfigSchema,
  rulewrightSessionSchema,
  workflowDeploymentKey,
} from '@rulebook/shared';
import { createClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import type { Address, Hex } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantService } from '../src/assistant/service.js';
import { registerAssistantRoutes } from '../src/assistant/routes.js';
import { AssistantToolExecutor } from '../src/assistant/tools.js';
import { loadConfig } from '../src/config.js';
import { RulewrightService } from '../src/rulewright/service.js';
import { registerRulewrightRoutes } from '../src/rulewright/routes.js';
import { registerWorkflowV2Routes } from '../src/workflows/routesV2.js';

const origin = 'https://rulebook.example';
const factory = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const demoOwner = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc' as Address;
const runId = `0x${'ab'.repeat(32)}` as Hex;
const workflowId = `0x${'cd'.repeat(32)}` as Hex;

const deployment = {
  lasna: { factory, startBlock: 1 },
  unichain: { factory: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address, startBlock: 1 },
};

const provider = {
  model: 'gemini-2.5-flash',
  endpoint: new URL('https://example.invalid/v1beta/openai/chat/completions'),
  apiKey: 'test-key',
};

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('demo mode backend support', () => {
  it('parses DEMO_ACCOUNT_ADDRESS and DEMO_FEATURED_RUN_IDS in loadConfig and rejects invalid values', () => {
    const valid = loadConfig({
      ...baseEnv,
      DEMO_ACCOUNT_ADDRESS: demoOwner.toUpperCase().replace('0X', '0x'),
      DEMO_FEATURED_RUN_IDS: `${runId}, ${workflowId}, ${runId}`,
    });
    expect(valid.demoAccount).toBe(demoOwner);
    expect(valid.demoFeaturedRunIds).toEqual([runId, workflowId]);

    expect(() =>
      loadConfig({
        ...baseEnv,
        DEMO_ACCOUNT_ADDRESS: '0x0000000000000000000000000000000000000000',
      }),
    ).toThrow(/DEMO_ACCOUNT_ADDRESS/);

    expect(() =>
      loadConfig({
        ...baseEnv,
        DEMO_FEATURED_RUN_IDS: 'not-a-run-id',
      }),
    ).toThrow(/DEMO_FEATURED_RUN_IDS/);
  });

  it('serves /v3/demo on testnet with featured runs, and returns unavailable on mainnet or when unconfigured', async () => {
    const db = createClient('https://database.example', 'fixture-key', {
      global: {
        fetch: async (input) => {
          const url = new URL(String(input));
          expect(url.pathname).toContain('workflow_v2_activity');
          expect(url.searchParams.get('owner')).toBe(`eq.${demoOwner}`);
          expect(url.searchParams.get('deployment')).toBe(
            `eq.${workflowDeploymentKey(LASNA_CHAIN_ID, factory)}`,
          );
          return Response.json([
            {
              id: runId,
              workflow_id: workflowId,
              title: 'Income sweep demo',
              chain: UNICHAIN_SEPOLIA_CHAIN_ID,
              origin_chain: UNICHAIN_SEPOLIA_CHAIN_ID,
              status: 'confirmed',
              path: 0,
            },
          ]);
        },
      },
    });

    const app = Fastify();
    registerWorkflowV2Routes(app, db, { testnet: factory }, undefined, {
      owner: demoOwner,
      featuredRunIds: [runId],
    });

    const testnetResponse = await app.inject({ url: '/v3/demo?network=testnet' });
    expect(testnetResponse.statusCode).toBe(200);
    expect(demoAccountConfigSchema.parse(testnetResponse.json())).toEqual({
      available: true,
      owner: demoOwner,
      network: 'testnet',
      featuredRuns: [
        {
          id: runId,
          workflowId,
          title: 'Income sweep demo',
          chain: UNICHAIN_SEPOLIA_CHAIN_ID,
          originChain: UNICHAIN_SEPOLIA_CHAIN_ID,
          status: 'confirmed',
          path: 0,
        },
      ],
    });

    const mainnetResponse = await app.inject({ url: '/v3/demo?network=mainnet' });
    expect(mainnetResponse.statusCode).toBe(200);
    expect(demoAccountConfigSchema.parse(mainnetResponse.json())).toEqual({
      available: false,
      owner: null,
      network: 'mainnet',
      featuredRuns: [],
    });

    const unconfiguredApp = Fastify();
    registerWorkflowV2Routes(unconfiguredApp, db, { testnet: factory });
    const unconfiguredResponse = await unconfiguredApp.inject({ url: '/v3/demo' });
    expect(demoAccountConfigSchema.parse(unconfiguredResponse.json())).toEqual({
      available: false,
      owner: null,
      network: 'testnet',
      featuredRuns: [],
    });

    await Promise.all([app.close(), unconfiguredApp.close()]);
  });

  it('issues wallet-free Rulewright demo sessions only on testnet from allowed origins', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const from = vi.fn((table: string) => {
      expect(table).toBe('rulewright_sessions');
      return {
        select: () => ({ limit: () => ({ abortSignal: async () => ({ error: null }) }) }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { abortSignal: async () => ({ error: null }) };
        },
      };
    });
    const service = new RulewrightService(
      { from } as never,
      {} as never,
      { [UNICHAIN_SEPOLIA_CHAIN_ID]: deployment.unichain.factory },
      provider,
      demoOwner,
    );
    const app = Fastify();
    registerRulewrightRoutes(app, {
      config: { corsOrigins: [origin] } as never,
      rulewright: service,
      databaseReachable: async () => true,
      rpcHealth: async () => [],
    });

    const availability = await app.inject({ url: '/v2/rulewright/availability?network=testnet' });
    expect(availability.json()).toEqual({ available: true, demoAvailable: true });

    const mainnetAvailability = await app.inject({
      url: '/v2/rulewright/availability?network=mainnet',
    });
    expect(mainnetAvailability.json()).toEqual({ available: false });

    const badOrigin = await app.inject({
      method: 'POST',
      url: '/v2/rulewright/demo-session',
      headers: { origin: 'https://evil.example' },
      payload: { network: 'testnet' },
    });
    expect(badOrigin.statusCode).toBe(403);

    const mainnetSession = await app.inject({
      method: 'POST',
      url: '/v2/rulewright/demo-session',
      headers: { origin },
      payload: { network: 'mainnet' },
    });
    expect(mainnetSession.statusCode).toBe(503);

    const created = await app.inject({
      method: 'POST',
      url: '/v2/rulewright/demo-session',
      headers: { origin },
      payload: { network: 'testnet' },
    });
    expect(created.statusCode).toBe(200);
    const parsed = rulewrightSessionSchema.parse(created.json());
    expect(parsed.token).toHaveLength(43);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      owner: demoOwner,
      origin,
      network: 'testnet',
    });
    expect(String(inserted[0]!.nonce)).toMatch(/^demo:/);

    await app.close();
  });

  it('issues scoped Bookkeeper demo sessions and redacts Telegram notifications', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const from = vi.fn((table: string) => {
      if (table === 'telegram_accounts' || table === 'telegram_workflow_preferences') {
        throw new Error('Demo mode must never query Telegram tables');
      }
      expect(table).toBe('assistant_sessions');
      return {
        select: () => ({
          limit: () => ({ abortSignal: async () => ({ error: null }) }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { abortSignal: async () => ({ error: null }) };
        },
      };
    });

    const service = new AssistantService(
      { from } as never,
      {} as never,
      { testnet: deployment },
      provider,
      demoOwner,
    );
    const app = Fastify();
    registerAssistantRoutes(app, {
      config: { corsOrigins: [origin] } as never,
      assistant: service,
      databaseReachable: async () => true,
      rpcHealth: async () => [],
    });

    const availability = await app.inject({ url: '/v2/assistant/availability?network=testnet' });
    expect(availability.json()).toEqual({ available: true, demoAvailable: true });

    const mainnetSession = await app.inject({
      method: 'POST',
      url: '/v2/assistant/demo-session',
      headers: { origin },
      payload: { network: 'mainnet' },
    });
    expect(mainnetSession.statusCode).toBe(503);

    const created = await app.inject({
      method: 'POST',
      url: '/v2/assistant/demo-session',
      headers: { origin },
      payload: { network: 'testnet' },
    });
    expect(created.statusCode).toBe(200);
    const session = assistantDemoSessionSchema.parse(created.json());
    expect(session.owner).toBe(demoOwner);
    expect(inserted).toMatchObject([{ owner: demoOwner, origin, network: 'testnet', demo: true }]);

    const executor = new AssistantToolExecutor(
      { from } as never,
      {} as never,
      deployment,
      demoOwner,
      { demo: true },
    );
    const notifications = await executor.execute('get_notifications', {});
    expect(notifications.detail).toBe('Hidden in demo mode');
    expect(JSON.parse(notifications.content)).toMatchObject({
      connection: 'redacted',
    });

    await app.close();
  });
});
