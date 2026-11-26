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
});
