import {
  CHAIN_CONFIGS,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type Address,
  type RuleParams,
} from '@rulebook/shared';
import { formatUnits } from 'viem';

export interface SignatureDetails {
  readonly chainId: typeof LASNA_CHAIN_ID | typeof UNICHAIN_SEPOLIA_CHAIN_ID;
  readonly target: Address;
  readonly targetLabel: string;
  readonly effect: string;
  readonly amount: string;
}

export type ControlFunction = 'pauseRule' | 'resumeRule' | 'cancelRule' | 'detachMirror';
type RuleSpend = Pick<RuleParams, 'chainId' | 'tokenIn' | 'amountIn'>;
type MirrorTerms = {
  readonly leaderVault: Address;
  readonly leaderRuleId: bigint;
  readonly scaleBps: number;
  readonly hourlyCap: number;
};

const noSpend = 'No principal moves.';

export function knownToken(chainId: number, token: string | undefined) {
  const chain = CHAIN_CONFIGS.get(chainId);
  if (!chain) return undefined;
  const address = token?.toLowerCase();
  if (address === chain.usdc.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (address === chain.weth.toLowerCase()) return { symbol: 'WETH', decimals: 18 };
  return undefined;
}

export function signatureTokenAmount(chainId: number, token: Address, amount: bigint): string {
  const info = knownToken(chainId, token);
  if (info) return `${formatUnits(amount, info.decimals)} ${info.symbol}`;
  return `${amount} base units of token ${token}`;
}

function ruleSpend(rule: RuleSpend): string {
  if (rule.amountIn === 0n) return noSpend;
  return `${signatureTokenAmount(rule.chainId, rule.tokenIn, rule.amountIn)} per run. No principal moves when you sign.`;
}

function automation(target: Address, effect: string, amount = noSpend): SignatureDetails {
  return { chainId: LASNA_CHAIN_ID, target, targetLabel: 'Automation account', effect, amount };
}

const controlEffect: Record<ControlFunction, (id: bigint) => string> = {
  pauseRule: (id) => `Pause rule #${id} until you resume it.`,
  resumeRule: (id) => `Resume rule #${id} so it can run again.`,
  cancelRule: (id) => `Permanently cancel rule #${id} to stop future runs.`,
  detachMirror: (id) => `Detach mirror #${id} to stop following future leader trades.`,
};

export const signatureDetails = {
  authorizeVault(factory: Address, agent: Address, vaultMode?: 'mirror'): SignatureDetails {
    return {
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      target: factory,
      targetLabel: 'Funds account factory',
      effect:
        vaultMode === 'mirror'
          ? `Authorize a mirror-only funds account that you own for automation account ${agent}. Vault mode is permanent.`
          : `Authorize the sponsor to create a funds account that you own for automation account ${agent}.`,
      amount: noSpend,
    };
  },
  linkVault(agent: Address, vault: Address): SignatureDetails {
    return automation(agent, `Link your funds account ${vault} so your rules can use it.`);
  },
  create(agent: Address, rule: RuleSpend, sentence: string, publish: boolean): SignatureDetails {
    const change = publish ? 'Create a rule and publish it to the marketplace.' : 'Create a rule.';
    return automation(agent, `${change} ${sentence}`, ruleSpend(rule));
  },
  control(agent: Address, action: ControlFunction, ruleId: bigint): SignatureDetails {
    return automation(agent, controlEffect[action](ruleId));
  },
  reorder(agent: Address, rules: readonly bigint[]): SignatureDetails {
    return automation(
      agent,
      `Evaluate rules in this order: ${rules.map((id) => `#${id}`).join(', ')}.`,
    );
  },
  withdraw(vault: Address, destination: Address, amount: string): SignatureDetails {
    return {
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      target: vault,
      targetLabel: 'Funds account',
      effect: `Send principal to ${destination}. This withdrawal is final.`,
      amount,
    };
  },
  clone(agent: Address, rule: RuleSpend, sentence: string): SignatureDetails {
    return automation(agent, `Create a private copy of this rule. ${sentence}`, ruleSpend(rule));
  },
  mirror(agent: Address, ruleId: bigint, terms: MirrorTerms, cap: string): SignatureDetails {
    return automation(
      agent,
      `Set rule #${ruleId} to mirror leader rule #${terms.leaderRuleId} from ${terms.leaderVault} at ${formatUnits(BigInt(terms.scaleBps), 2)}% of its trade size, up to ${terms.hourlyCap} times per hour.`,
      `Up to ${cap} per run. No principal moves when you sign.`,
    );
  },
};
