// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../src/lib/api.js';

describe('ApiClient', () => {
  it('exposes only active endpoints and drops dead V1 routes', () => {
    const client = new ApiClient('http://localhost:8787');
    for (const removed of [
      'chains',
      'account',
      'executions',
      'rules',
      'rulesFeed',
      'ruleDetail',
      'marketplace',
      'leaderboard',
      'sponsor',
      'proof',
    ]) {
      expect(removed in client).toBe(false);
    }
    for (const active of [
      'health',
      'rulewrightAvailability',
      'rulewrightChallenge',
      'rulewrightSession',
      'rulewrightEnqueue',
      'rulewrightJob',
      'assistantAvailability',
      'assistantChallenge',
      'assistantSession',
      'telegramAvailability',
      'telegramSettings',
    ]) {
      expect(typeof (client as unknown as Record<string, unknown>)[active]).toBe('function');
    }
  });

  it('calls active health, rulewright, assistant, and telegram availability routes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Response.json({
          status: 'ok',
          indexer: { enabled: true, lag_seconds: 0, cursors: [] },
          database: { reachable: true, paused_hint: null },
          chains: [],
        });
      }
      return Response.json({ available: true });
    });
    const client = new ApiClient('http://localhost:8787', fetchMock);

    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
    await expect(client.rulewrightAvailability()).resolves.toEqual({ available: true });
    await expect(client.rulewrightAvailability(undefined, 'testnet')).resolves.toEqual({
      available: true,
    });
    await expect(client.rulewrightAvailability(undefined, 'mainnet')).resolves.toEqual({
      available: true,
    });
    await expect(client.assistantAvailability()).resolves.toEqual({ available: true });
    await expect(client.assistantAvailability(undefined, 'testnet')).resolves.toEqual({
      available: true,
    });
    await expect(client.assistantAvailability(undefined, 'mainnet')).resolves.toEqual({
      available: true,
    });
    await expect(client.telegramAvailability(true)).resolves.toEqual({ available: true });
    await expect(client.telegramAvailability(true, 'mainnet')).resolves.toEqual({
      available: true,
    });
    await expect(
      client
        .telegramSettings('0x1111111111111111111111111111111111111111', undefined, 'mainnet')
        .catch(() => 'parsed'),
    ).resolves.toBe('parsed');

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'http://localhost:8787/health',
      'http://localhost:8787/v2/rulewright/availability',
      'http://localhost:8787/v2/rulewright/availability?network=testnet',
      'http://localhost:8787/v2/rulewright/availability?network=mainnet',
      'http://localhost:8787/v2/assistant/availability',
      'http://localhost:8787/v2/assistant/availability?network=testnet',
      'http://localhost:8787/v2/assistant/availability?network=mainnet',
      '/v1/telegram/availability?workflow=true',
      '/v1/telegram/availability?workflow=true&network=mainnet',
      '/v1/accounts/0x1111111111111111111111111111111111111111/telegram?network=mainnet',
    ]);
  });

  it('includes network mode in rulewrightChallenge and assistantChallenge requests', async () => {
    const owner = '0x1111111111111111111111111111111111111111';
    const bodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        nonce: `0x${'1'.repeat(64)}`,
        owner,
        origin: 'http://localhost:5173',
        network: 'mainnet',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      });
    });
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
    try {
      const client = new ApiClient('http://localhost:8787', fetchMock);
      await client.rulewrightChallenge(owner, new AbortController().signal, 'mainnet');
      await client.assistantChallenge(owner, new AbortController().signal, 'mainnet');
      expect(bodies).toEqual([
        { owner, network: 'mainnet' },
        { owner, network: 'mainnet' },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
