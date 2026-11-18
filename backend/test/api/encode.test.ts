import { encodeAddRule } from '@rulebook/shared';
import type { Address } from '@rulebook/shared';
import { describe, expect, it } from 'vitest';

import { TEMPLATE_FIXTURES } from '../../../contracts/test/templates/fixtures.generated.js';

import type { AppConfig } from '../../src/config.js';
import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import { CursorStore } from '../../src/indexer/cursors.js';
import { buildServer } from '../../src/server.js';

const config: AppConfig = {
  PORT: 8787,
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  LASNA_RPC_URL: 'https://lasna-rpc.rnk.dev/',
  UNICHAIN_RPC_URL: 'https://sepolia.unichain.org',
  INDEXER_ENABLED: false,
  INDEXER_START_BLOCK_LASNA: 0,
  INDEXER_START_BLOCK_UNICHAIN: 0,
  corsOrigins: ['http://localhost:5173'],
};

const AGENT = '0x1111111111111111111111111111111111111111' as Address;
const CHAIN_ID = 1301;

function makeApp() {
  const store = new InMemoryStore();
  const built = buildServer(
    {
      config,
      repositories: createRepositories(store),
      cursors: new CursorStore(store),
      databaseReachable: async () => true,
      rpcHealth: async () => [
        { chain_id: 5_318_007, rpc_ok: true },
        { chain_id: 1301, rpc_ok: true },
      ],
      accountChain: { agentLink: async () => null, vaultOwner: async () => null },
    },
    { logger: false },
  );
  return built.app;
}

describe('POST /v1/encode/preview', () => {
  it('produces byte-identical calldata to the shared encoder for all 13 templates', async () => {
    const app = makeApp();
    try {
      for (const fixture of TEMPLATE_FIXTURES) {
        const draft = {
          template: fixture.template,
          chainId: CHAIN_ID,
          slots: { ...fixture.slots },
        };
        const expected = encodeAddRule(AGENT, draft);

        const response = await app.inject({
          method: 'POST',
          url: '/v1/encode/preview',
          payload: {
            template: fixture.template,
            chain_id: CHAIN_ID,
            slots: fixture.slots,
            agent: AGENT,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as { to: string; data: string; readable_sentence: string };
        expect(body.data).toBe(expected);
        expect(body.to).toBe(AGENT);
        expect(body.readable_sentence).toBe(fixture.sentence);
      }
    } finally {
      await app.close();
    }
  });

  it('returns 422 and the missing slots for an incomplete draft', async () => {
    const app = makeApp();
    try {
      const fixture = TEMPLATE_FIXTURES[0];
      if (!fixture) throw new Error('no fixture');
      const slots = { ...fixture.slots };
      delete slots.amount_in;

      const response = await app.inject({
        method: 'POST',
        url: '/v1/encode/preview',
        payload: { template: fixture.template, chain_id: CHAIN_ID, slots, agent: AGENT },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json() as { error: { code: string; detail?: string } };
      expect(body.error.code).toBe('incomplete_draft');
      expect(body.error.detail).toContain('amount_in');
    } finally {
      await app.close();
    }
  });

  it('rejects a free-text slot key', async () => {
    const app = makeApp();
    try {
      const fixture = TEMPLATE_FIXTURES[0];
      if (!fixture) throw new Error('no fixture');
      const response = await app.inject({
        method: 'POST',
        url: '/v1/encode/preview',
        payload: {
          template: fixture.template,
          chain_id: CHAIN_ID,
          slots: { ...fixture.slots, prompt: 'buy the dip' },
          agent: AGENT,
        },
      });
      expect(response.statusCode).toBe(422);
      expect((response.json() as { error: { code: string } }).error.code).toBe('unknown_slot');
    } finally {
      await app.close();
    }
  });
});
