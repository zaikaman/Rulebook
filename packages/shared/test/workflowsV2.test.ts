import { describe, expect, it } from 'vitest';

import {
  createWorkflowV2Recipe,
  decodeWorkflowV2,
  encodeWorkflowV2,
  workflowV2Recipes,
} from '../src/index.js';

const recipient = '0x0000000000000000000000000000000000000002';
const other = '0x0000000000000000000000000000000000000003';
const values = {
  intervalSeconds: '3600',
  expiresAt: '1900000000',
  buyUsdc: '1.5',
  sellWeth: '0.001',
  slippagePercent: '0.5',
  dipPercent: '5',
  limitPrice: '1500',
  targetPrice: '2500',
  stopPrice: '1250',
  trailPercent: '8',
  bandPercent: '5',
  referencePrice: '2000',
  recipient,
  sendUsdc: '12',
  minimumPaymentUsdc: '15',
  floorUsdc: '4',
  refillUsdc: '2',
  inactivitySeconds: '604800',
  direction: 'rising',
  lowerPrice: '1000',
  upperPrice: '3000',
  token: other,
  minimumTransferRaw: '1000000',
};

describe('V2 recipe programs', () => {
  it('exposes exactly the original 13 recipes', () => {
    expect(new Set(workflowV2Recipes.map(({ id }) => id)).size).toBe(13);
  });

  it.each(workflowV2Recipes)(
    'round-trips $title through the generated contract ABI',
    ({ id, chain, trigger }) => {
      const program = createWorkflowV2Recipe(id, values, { inactivityPayout: true });
      expect(program.chain).toBe(chain);
      expect(program.trigger).toBe(trigger);
      expect(program.nodes.some(({ actions }) => actions.length > 0)).toBe(true);
      expect(decodeWorkflowV2(encodeWorkflowV2(program))).toEqual(program);
    },
  );

  it('requires a fixed recipient and explicit consent for inactivity payouts', () => {
    expect(() => createWorkflowV2Recipe('inactivity-payout', values)).toThrow('Confirm');
    expect(() =>
      createWorkflowV2Recipe(
        'inactivity-payout',
        { ...values, recipient: '' },
        { inactivityPayout: true },
      ),
    ).toThrow('recipient');
    const payout = createWorkflowV2Recipe('inactivity-payout', values, {
      inactivityPayout: true,
    });
    expect(payout.once).toBe(true);
    expect(payout.nodes[1]?.actions[0]?.account).toBe(recipient);
  });

  it('retains both trading caps and supports two qualifying sweep paths', () => {
    const sweep = createWorkflowV2Recipe('income-sweep', {
      ...values,
      smallPaymentUsdc: '5',
      smallSweepUsdc: '1',
    });
    expect(sweep.nodes.filter((node) => node.actions.length > 0)).toHaveLength(2);
    const band = createWorkflowV2Recipe('price-band', values);
    expect(band.usdcCap).toBe(1_500_000n);
    expect(band.wethCap).toBe(1_000_000_000_000_000n);
  });
});
