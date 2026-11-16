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

function executedLog(): RawLog {
  return {
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
});
