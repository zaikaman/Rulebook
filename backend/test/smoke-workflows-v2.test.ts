import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import {
  LOG_BLOCK_CHUNK_SIZE,
  getLogsChunked,
  nextLogScanCursor,
  resolveSmokeSignerKey,
} from '../../scripts/smoke-workflows-v2.js';

const KEY_A = `0x${'11'.repeat(32)}` as const;
const KEY_B = `0x${'22'.repeat(32)}` as const;
const KEY_B_BARE = '22'.repeat(32);

describe('smoke-workflows-v2', () => {
  describe('resolveSmokeSignerKey', () => {
    it('uses DEPLOYER_PRIVATE_KEY on testnet and fails when unset', () => {
      expect(resolveSmokeSignerKey(false, { DEPLOYER_PRIVATE_KEY: KEY_A })).toBe(KEY_A);
      expect(resolveSmokeSignerKey(false, { DEPLOYER_PRIVATE_KEY: KEY_B_BARE })).toBe(KEY_B);
      expect(() => resolveSmokeSignerKey(false, {})).toThrow(
        /Set DEPLOYER_PRIVATE_KEY before running the live smoke/,
      );
    });

    it('requires MAINNET_DEPLOYER_PRIVATE_KEY on mainnet even if DEPLOYER_PRIVATE_KEY is set', () => {
      expect(() => resolveSmokeSignerKey(true, { DEPLOYER_PRIVATE_KEY: KEY_A })).toThrow(
        /Set a dedicated MAINNET_DEPLOYER_PRIVATE_KEY/,
      );
    });

    it('blocks reusing DEPLOYER_PRIVATE_KEY or SPONSOR_PRIVATE_KEY on mainnet', () => {
      const addressA = privateKeyToAccount(KEY_A).address;
      expect(() =>
        resolveSmokeSignerKey(true, {
          MAINNET_DEPLOYER_PRIVATE_KEY: KEY_A,
          DEPLOYER_PRIVATE_KEY: KEY_A.slice(2),
        }),
      ).toThrow(
        new RegExp(`must not share an address with DEPLOYER_PRIVATE_KEY \\(${addressA}\\)`),
      );

      expect(() =>
        resolveSmokeSignerKey(true, {
          MAINNET_DEPLOYER_PRIVATE_KEY: KEY_B_BARE,
          SPONSOR_PRIVATE_KEY: KEY_B,
        }),
      ).toThrow(/must not share an address with SPONSOR_PRIVATE_KEY/);
    });

    it('accepts a distinct MAINNET_DEPLOYER_PRIVATE_KEY on mainnet', () => {
      expect(
        resolveSmokeSignerKey(true, {
          MAINNET_DEPLOYER_PRIVATE_KEY: KEY_B_BARE,
          DEPLOYER_PRIVATE_KEY: KEY_A,
        }),
      ).toBe(KEY_B);
    });
  });

  describe('getLogsChunked', () => {
    it('chunks ranges above Unichain 1,000-block RPC cap into <=200-block inclusive windows', async () => {
      expect(LOG_BLOCK_CHUNK_SIZE).toBe(200n);
      const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
      const fetchChunk = vi.fn(async (range: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push(range);
        return [`log-${range.fromBlock}-${range.toBlock}`];
      });

      const result = await getLogsChunked(async () => 3499n, fetchChunk, 1000n);

      expect(result.lastScannedBlock).toBe(3499n);
      expect(ranges).toHaveLength(13);
      expect(ranges[0]).toEqual({ fromBlock: 1000n, toBlock: 1199n });
      expect(ranges[11]).toEqual({ fromBlock: 3200n, toBlock: 3399n });
      expect(ranges[12]).toEqual({ fromBlock: 3400n, toBlock: 3499n });
      for (const range of ranges) {
        const span = range.toBlock - range.fromBlock + 1n;
        expect(span).toBeGreaterThan(0n);
        expect(span).toBeLessThanOrEqual(LOG_BLOCK_CHUNK_SIZE);
        expect(span).toBeLessThanOrEqual(1000n);
      }
      expect(result.logs[0]).toBe('log-1000-1199');
      expect(result.logs[result.logs.length - 1]).toBe('log-3400-3499');
    });

    it('handles exact chunk multiples and single-block ranges cleanly', async () => {
      const exactRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
      await getLogsChunked(
        async () => 399n,
        async (range) => {
          exactRanges.push(range);
          return [];
        },
        0n,
      );
      expect(exactRanges).toEqual([
        { fromBlock: 0n, toBlock: 199n },
        { fromBlock: 200n, toBlock: 399n },
      ]);

      const singleRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
      await getLogsChunked(
        async () => 50n,
        async (range) => {
          singleRanges.push(range);
          return ['only'];
        },
        50n,
      );
      expect(singleRanges).toEqual([{ fromBlock: 50n, toBlock: 50n }]);
    });

    it('returns empty without calling fetchChunk when fromBlock is ahead of head', async () => {
      const fetchChunk = vi.fn();
      const result = await getLogsChunked(async () => 100n, fetchChunk, 101n);
      expect(result).toEqual({ logs: [], lastScannedBlock: null });
      expect(fetchChunk).not.toHaveBeenCalled();
    });

    it('rejects non-positive chunk sizes', async () => {
      await expect(
        getLogsChunked(
          async () => 10n,
          async () => [],
          0n,
          0n,
        ),
      ).rejects.toThrow(/at least 1/);
    });
  });

  describe('nextLogScanCursor', () => {
    it('advances cursor with 2-block reorg overlap and clamps to startBlock', () => {
      expect(nextLogScanCursor(1000n, 1000n, null)).toBe(1000n);
      expect(nextLogScanCursor(1000n, 1000n, 1000n)).toBe(1000n);
      expect(nextLogScanCursor(1000n, 1000n, 1001n)).toBe(1000n);
      expect(nextLogScanCursor(1000n, 1000n, 1500n)).toBe(1498n);
      expect(nextLogScanCursor(0n, 0n, 1n)).toBe(0n);
    });
  });
});
