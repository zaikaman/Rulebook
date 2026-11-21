import {
  emptyDraft,
  readWeeklyLimit,
  v2DraftSchema,
  weeklyBudgetCeiling,
  weeklyBudgetFromDraft,
} from '@rulebook/shared';
import { describe, expect, it } from 'vitest';

describe('weekly spending budgets', () => {
  it('restores an older draft with blank weekly limits', () => {
    const legacy = { ...emptyDraft() } as Record<string, unknown>;
    delete legacy.usdcWeeklyBudget;
    delete legacy.wethWeeklyBudget;
    const restored = v2DraftSchema.parse(legacy);
    expect(restored.usdcWeeklyBudget).toBe('');
    expect(restored.wethWeeklyBudget).toBe('');
    expect(weeklyBudgetFromDraft(restored)).toEqual({ usdc: 0n, weth: 0n });
  });

  it('treats a blank field as unlimited and rejects zero or over-precise values', () => {
    expect(readWeeklyLimit('', 'USDC')).toBe(0n);
    expect(readWeeklyLimit('10', 'USDC')).toBe(10_000_000n);
    expect(readWeeklyLimit('0.1', 'WETH')).toBe(100_000_000_000_000_000n);
    expect(() => readWeeklyLimit('0', 'USDC')).toThrow(/positive/);
    expect(() => readWeeklyLimit('1.0000001', 'USDC')).toThrow(/valid/);
    expect(() => readWeeklyLimit('1.0000000000000000001', 'WETH')).toThrow(/valid/);
  });

  it('rejects a limit above the Vault uint96 bound', () => {
    expect(readWeeklyLimit('79228162514264337593543.950335', 'USDC')).toBe(weeklyBudgetCeiling);
    expect(() => readWeeklyLimit('79228162514264337593543.950336', 'USDC')).toThrow(/maximum/);
    expect(() => readWeeklyLimit('79228162514.264337593543950336', 'WETH')).toThrow(/maximum/);
  });

  it('validates each asset independently', () => {
    expect(weeklyBudgetFromDraft({ usdcWeeklyBudget: '25', wethWeeklyBudget: '' })).toEqual({
      usdc: 25_000_000n,
      weth: 0n,
    });
    expect(() => weeklyBudgetFromDraft({ usdcWeeklyBudget: '', wethWeeklyBudget: '-1' })).toThrow(
      /WETH/,
    );
  });
});
