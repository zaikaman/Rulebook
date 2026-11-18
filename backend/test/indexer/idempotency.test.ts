import { encodeAbiParameters, toEventSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import { createRepositories } from '../../src/db/repositories/index.js';
import { InMemoryStore } from '../../src/db/store.js';
import { decodeLog, persistDecodedEvent, type RawLog } from '../../src/indexer/decoders/index.js';

const AGENT = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';

function ruleCreatedLog(index: number): RawLog {
  return {
    chainId: 5_318_007,
    address: AGENT,
    topics: [
      toEventSelector('RuleCreated(address,uint256,uint8,bool)'),
      `0x${AGENT.slice(2).padStart(64, '0')}`,
      `0x${index.toString(16).padStart(64, '0')}`,
    ],
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'bool' }], [1, false]),
    blockNumber: 100n,
    transactionHash: `0x${'a'.repeat(64)}`,
    logIndex: 0,
    blockTime: '2026-11-16T00:00:00.000Z',
  };
}

function agentDeployedLog(): RawLog {
  return {
    chainId: 5_318_007,
    address: '0x3333333333333333333333333333333333333333',
    topics: [
      toEventSelector('AgentDeployed(address,address,uint256)'),
      `0x${AGENT.slice(2).padStart(64, '0')}`,
      `0x${'4'.repeat(64)}`,
    ],
    data: encodeAbiParameters([{ type: 'uint256' }], [1n]),
    blockNumber: 50n,
    transactionHash: `0x${'c'.repeat(64)}`,
    logIndex: 0,
    blockTime: '2026-11-16T00:00:00.000Z',
  };
}

function vaultDeployedLog(): RawLog {
  return {
    chainId: 1301,
    address: '0x5555555555555555555555555555555555555555',
    topics: [
      toEventSelector('VaultDeployed(address,address,address,uint256)'),
      `0x${'6'.repeat(64)}`,
      `0x${VAULT.slice(2).padStart(64, '0')}`,
      `0x${AGENT.slice(2).padStart(64, '0')}`,
    ],
    data: encodeAbiParameters([{ type: 'uint256' }], [1301n]),
    blockNumber: 60n,
    transactionHash: `0x${'d'.repeat(64)}`,
    logIndex: 0,
    blockTime: '2026-11-16T00:00:01.000Z',
  };
}

const PARAMS_HASH = `0x${'e'.repeat(64)}`;

function topicAddress(address: string): `0x${string}` {
  return `0x${address.slice(2).padStart(64, '0')}`;
}

function topicNumber(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function ruleListedLog(index = 0): RawLog {
  return {
    chainId: 5_318_007,
    address: '0x7777777777777777777777777777777777777777',
    topics: [
      toEventSelector('RuleListed(address,address,uint256,uint8,bytes32,string)'),
      topicAddress(AGENT),
      topicAddress(AGENT),
      topicNumber(index),
    ],
    data: encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'string' }],
      [1, PARAMS_HASH, 'rulebook://listing/1'],
    ),
    blockNumber: 110n,
    transactionHash: `0x${'f'.repeat(64)}`,
    logIndex: 0,
    blockTime: '2026-11-16T00:00:02.000Z',
  };
}

function ruleDelistedLog(index = 0): RawLog {
  return {
    chainId: 5_318_007,
    address: '0x7777777777777777777777777777777777777777',
    topics: [
      toEventSelector('RuleDelisted(address,address,uint256)'),
      topicAddress(AGENT),
      topicAddress(AGENT),
      topicNumber(index),
    ],
    data: '0x',
    blockNumber: 120n,
    transactionHash: `0x${'9'.repeat(64)}`,
    logIndex: 0,
    blockTime: '2026-11-16T00:00:03.000Z',
  };
}

function executedLog(): RawLog {  return {
    chainId: 1301,
    address: VAULT,
    topics: [
      toEventSelector('Executed(uint256,address,address,uint256,uint256,uint256)'),
      `0x${(1).toString(16).padStart(64, '0')}`,
    ],
    data: encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        '0x31d0220469e10c4E71834a79b1f276d740d3768F',
        '0x4200000000000000000000000000000000000006',
        10_000_000n,
        9_900_000n,
        1_700_000_000n,
      ],
    ),
    blockNumber: 200n,
    transactionHash: `0x${'b'.repeat(64)}`,
    logIndex: 1,
    blockTime: '2026-11-16T00:00:12.000Z',
  };
}

describe('indexer idempotency', () => {
  it('replaying the same RuleCreated log twice writes one rule and one event row', async () => {
    const store = new InMemoryStore();
    const repositories = createRepositories(store);
    const outcome = decodeLog(ruleCreatedLog(0));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    await persistDecodedEvent(repositories, outcome.event);
    await persistDecodedEvent(repositories, outcome.event);

    expect(await store.count('rules', { agent: AGENT })).toBe(1);
    expect(await store.count('rule_events', { agent: AGENT })).toBe(1);
  });

  it('records AgentDeployed and VaultDeployed with owner, agent, chain, and creation tx', async () => {
    const store = new InMemoryStore();
    const repositories = createRepositories(store);

    for (const raw of [agentDeployedLog(), vaultDeployedLog()]) {
      const outcome = decodeLog(raw);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      await persistDecodedEvent(repositories, outcome.event);
      await persistDecodedEvent(repositories, outcome.event);
    }

    const agent = await repositories.agents.get(`0x${'4'.repeat(40)}`);
    expect(agent).toMatchObject({
      owner: AGENT,
      created_tx: `0x${'c'.repeat(64)}`,
      chain_id: 5_318_007,
    });

    const vault = await repositories.vaults.get(VAULT);
    expect(vault).toMatchObject({
      owner: `0x${'6'.repeat(40)}`,
      agent: AGENT,
      chain_id: 1301,
      created_tx: `0x${'d'.repeat(64)}`,
    });
  });

  it('replaying the same Executed log twice writes one execution row', async () => {
    const store = new InMemoryStore();
    const repositories = createRepositories(store);
    const outcome = decodeLog(executedLog());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    await persistDecodedEvent(repositories, outcome.event);
    await persistDecodedEvent(repositories, outcome.event);
    expect(await store.count('executions')).toBe(1);
  });

  it('repairing a reorg removes the row whose transaction no longer exists', async () => {
    const store = new InMemoryStore();
    const repositories = createRepositories(store);
    const outcome = decodeLog(executedLog());
    if (!outcome.ok) throw new Error('fixture must decode');
    await persistDecodedEvent(repositories, outcome.event);
    expect(await store.count('executions')).toBe(1);

    await repositories.executions.deleteByTx(1301, `0x${'b'.repeat(64)}`);
    expect(await store.count('executions')).toBe(0);
  });

  it('reports an undecodable known event instead of persisting garbage', () => {
    const log = ruleCreatedLog(0);
    const broken: RawLog = { ...log, data: '0x' };
    const outcome = decodeLog(broken);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.known).toBe(true);
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });

  it('backfills a newly indexed rule from the Agent', async () => {
    const store = new InMemoryStore();
    const repositories = createRepositories(store);
    const outcome = decodeLog(ruleCreatedLog(0));
    if (!outcome.ok) throw new Error('fixture must decode');

    await persistDecodedEvent(repositories, outcome.event, {
      readRule: async () => ({
        template: 1,
        chainId: 1301,
        pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA',
        tokenIn: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
        tokenOut: '0x4200000000000000000000000000000000000006',
        amountIn: '10000000',
        threshold: '0',
        secondary: '604800',
      }),
    });

    expect(await repositories.rules.get(AGENT, '0')).toMatchObject({
      template: 1,
      chain_id: 1301,
      pair: '0x1d8698365321D6DcE1F7141c380C866b012eE9dA',
      token_in: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
      amount_in: '10000000',
      secondary: '604800',
    });
  });

  it('indexes RuleListed into a public listing and RuleDelisted hides it', async () => {
    const store = new InMemoryStore();
    const repositories = createRepositories(store);
    const created = decodeLog(ruleCreatedLog(0));
    const listed = decodeLog(ruleListedLog(0));
    const delisted = decodeLog(ruleDelistedLog(0));
    if (!created.ok || !listed.ok || !delisted.ok) throw new Error('fixtures must decode');

    await persistDecodedEvent(repositories, created.event);
    await persistDecodedEvent(repositories, listed.event);
    await persistDecodedEvent(repositories, listed.event);

    expect(await store.count('listings')).toBe(1);
    expect(await repositories.listings.get(5_318_007, AGENT, '0')).toMatchObject({
      listing_id: '0',
      rule_id: '0',
      agent: AGENT,
      author: AGENT,
      template: 1,
      metadata_uri: 'rulebook://listing/1',
      params_hash: PARAMS_HASH,
      author_badge: 'community',
      is_public: true,
    });
    expect((await repositories.rules.get(AGENT, '0'))?.is_public).toBe(true);

    await persistDecodedEvent(repositories, delisted.event);
    expect((await repositories.listings.get(5_318_007, AGENT, '0'))?.is_public).toBe(false);
    expect((await repositories.rules.get(AGENT, '0'))?.is_public).toBe(false);
  });
});
