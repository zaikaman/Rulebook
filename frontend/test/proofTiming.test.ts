import { describe, expect, it } from 'vitest';

import {
  computeProofLatency,
  formatBlockTimestamp,
  formatDurationSeconds,
  shortHex,
} from '../src/workflows/proofTiming.js';

describe('proofTiming', () => {
  it('formats durations across sub-second, seconds, minutes, and hours', () => {
    expect(formatDurationSeconds(0)).toBe('<1s');
    expect(formatDurationSeconds(0, { signed: true })).toBe('+<1s');
    expect(formatDurationSeconds(1, { signed: true })).toBe('+1s');
    expect(formatDurationSeconds(2, { signed: true })).toBe('+2s');
    expect(formatDurationSeconds(3)).toBe('3s');
    expect(formatDurationSeconds(65, { signed: true })).toBe('+1m 5s');
    expect(formatDurationSeconds(120)).toBe('2m');
    expect(formatDurationSeconds(3600)).toBe('1h');
    expect(formatDurationSeconds(3665, { signed: true })).toBe('+1h 1m');
  });

  it('formats UTC block timestamps and short hashes', () => {
    expect(formatBlockTimestamp(1_764_270_000)).toBe('Nov 27, 19:00:00 UTC');
    const hash = `0x${'a'.repeat(32)}${'b'.repeat(32)}` as const;
    expect(shortHex(hash)).toBe('0xaaaaaaaa…bbbbbb');
  });

  it('computes a 3-second Omni cross-chain loop breakdown', () => {
    const summary = computeProofLatency({
      originTimestamp: 1_764_270_000,
      decisionTimestamp: 1_764_270_001,
      settlementTimestamp: 1_764_270_003,
      hasOriginTx: true,
      hasSettlementTx: true,
      decisionShortName: 'Lasna',
    });

    expect(summary.isComplete).toBe(true);
    expect(summary.hasAnyTiming).toBe(true);
    expect(summary.clockSkewDetected).toBe(false);
    expect(summary.totalSeconds).toBe(3);
    expect(summary.formattedTotal).toBe('3s');
    expect(summary.hops.map((hop) => [hop.label, hop.formatted, hop.role])).toEqual([
      ['Origin -> Lasna', '+1s', 'automation'],
      ['Lasna -> Settlement', '+2s', 'funds'],
    ]);
    expect(summary.hops[0]!.share).toBeCloseTo(1 / 3, 5);
    expect(summary.hops[1]!.share).toBeCloseTo(2 / 3, 5);
  });

  it('handles sub-second hops, minor cross-chain clock skew, and severe negative skew', () => {
    const subSecond = computeProofLatency({
      originTimestamp: 1_764_270_000,
      decisionTimestamp: 1_764_270_000,
      settlementTimestamp: 1_764_270_002,
      hasOriginTx: true,
      hasSettlementTx: true,
      decisionShortName: 'Lasna',
    });
    expect(subSecond.hops[0]?.formatted).toBe('+<1s');
    expect(subSecond.hops[1]?.formatted).toBe('+2s');
    expect(subSecond.formattedTotal).toBe('2s');

    const minorSkew = computeProofLatency({
      originTimestamp: 1_764_270_002,
      decisionTimestamp: 1_764_270_000,
      settlementTimestamp: 1_764_270_004,
      hasOriginTx: true,
      hasSettlementTx: true,
      decisionShortName: 'Lasna',
    });
    expect(minorSkew.clockSkewDetected).toBe(true);
    expect(minorSkew.hops[0]?.formatted).toBe('+<1s');
    expect(minorSkew.hops[1]?.formatted).toBe('+4s');
    expect(minorSkew.formattedTotal).toBe('2s');

    const severeSkew = computeProofLatency({
      originTimestamp: 1_764_270_020,
      decisionTimestamp: 1_764_270_000,
      settlementTimestamp: 1_764_270_005,
      hasOriginTx: true,
      hasSettlementTx: true,
      decisionShortName: 'Lasna',
    });
    expect(severeSkew.clockSkewDetected).toBe(true);
    expect(severeSkew.hops[0]?.formatted).toBe('Unavailable');
    expect(severeSkew.hops[1]?.formatted).toBe('+5s');
    expect(severeSkew.formattedTotal).toBeNull();
    expect(severeSkew.isComplete).toBe(false);
  });

  it('handles internal schedule runs without an origin transaction and pending settlements', () => {
    const scheduleRun = computeProofLatency({
      originTimestamp: null,
      decisionTimestamp: 1_764_270_000,
      settlementTimestamp: 1_764_270_002,
      hasOriginTx: false,
      hasSettlementTx: true,
      decisionShortName: 'Reactive Mainnet',
    });
    expect(scheduleRun.isComplete).toBe(true);
    expect(scheduleRun.formattedTotal).toBe('2s');
    expect(scheduleRun.hops).toHaveLength(1);
    expect(scheduleRun.hops[0]).toMatchObject({
      label: 'Reactive Mainnet -> Settlement',
      formatted: '+2s',
      role: 'funds',
    });

    const pendingRun = computeProofLatency({
      originTimestamp: 1_764_270_000,
      decisionTimestamp: 1_764_270_001,
      settlementTimestamp: null,
      hasOriginTx: true,
      hasSettlementTx: false,
      settlementPending: true,
      decisionShortName: 'Lasna',
    });
    expect(pendingRun.isComplete).toBe(false);
    expect(pendingRun.hasAnyTiming).toBe(true);
    expect(pendingRun.formattedTotal).toBeNull();
    expect(pendingRun.hops[0]?.formatted).toBe('+1s');
    expect(pendingRun.hops[1]?.formatted).toBe('Pending');
    expect(pendingRun.hops[1]?.pending).toBe(true);
  });
});
