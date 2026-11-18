import { expect, it, vi } from 'vitest';

import { InMemoryStore } from '../../src/db/store.js';
import { reindex } from '../../src/indexer/backfill.js';
import { CursorStore } from '../../src/indexer/cursors.js';

it('replays through empty ranges and retains team listings and starter claims', async () => {
  const store = new InMemoryStore();
  const cursors = new CursorStore(store);
  const chainId = 1301;
  const staleBlockHash = `0x${'a'.repeat(64)}`;
  await cursors.set({ chain_id: chainId, last_block: 500, last_block_hash: staleBlockHash }, 0);
  await store.insert('executions', { tx_hash: 'stale' }, 'tx_hash');
  await store.insert('listings', { listing_id: '1', author_badge: 'team' }, 'listing_id');
  await store.insert('listings', { listing_id: '2', author_badge: 'community' }, 'listing_id');
  await store.insert('starter_funds', { owner: 'claimant' }, 'owner');

  const pollOnce = vi.fn(async (id: number) => {
    const cursor = await cursors.get(id);
    if (!cursor || cursor.last_block >= 130) return 0;
    const block = cursor.last_block + 10;
    await cursors.set({ chain_id: id, last_block: block, last_block_hash: staleBlockHash }, 0);
    if (block < 130) return 0;
    await store.insert('executions', { tx_hash: 'replayed' }, 'tx_hash');
    return 1;
  });

  await reindex({ store, cursors, startBlocks: { [chainId]: 100 }, poller: { pollOnce } });

  expect(pollOnce).toHaveBeenCalledTimes(4);
  expect(await cursors.get(chainId)).toMatchObject({ last_block: 130 });
  expect(await store.select('executions')).toEqual([{ tx_hash: 'replayed' }]);
  expect(await store.select('listings')).toEqual([{ listing_id: '1', author_badge: 'team' }]);
  expect(await store.count('starter_funds')).toBe(1);
});
