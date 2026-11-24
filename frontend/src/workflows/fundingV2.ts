import {
  workflowV2Action as A,
  workflowV2Trigger as T,
  workflowV2Unit as U,
  type WeeklyBudgetAmounts,
  type WorkflowV2Program,
} from '@rulebook/shared';
import { formatUnits, zeroAddress, type Address } from 'viem';

export interface WorkflowFundingNeeds {
  /** The largest fixed USDC spend in any one path. */
  readonly maxUsdc: bigint;
  /** The largest WETH sale in any one path. */
  readonly maxWeth: bigint;
  /** USDC that must already be in the Vault before a run. */
  readonly vaultUsdc: bigint;
  /** WETH that must already be in the Vault before a run. */
  readonly vaultWeth: bigint;
  /** USDC the Vault may pull from the owner's wallet for a refill. */
  readonly walletUsdc: bigint;
}

export interface WorkflowFundingBalances {
  readonly vault: Address;
  readonly stable: bigint;
  readonly wrapped: bigint;
  readonly walletStable: bigint;
}

export interface FundingIssue {
  readonly code:
    | 'cap-usdc'
    | 'cap-weth'
    | 'budget-usdc'
    | 'budget-weth'
    | 'vault-missing'
    | 'vault-usdc'
    | 'vault-weth'
    | 'wallet-usdc';
  readonly message: string;
  readonly recovery: 'account' | 'limits';
}

function amount(value: bigint, decimals: number, asset: string) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const trimmed = fraction?.replace(/0+$/, '');
  return `${whole}${trimmed ? `.${trimmed}` : ''} ${asset}`;
}

/**
 * The contract executes one terminal path per run. A path is safe only when its own spend fits,
 * so the requirement is the largest path, not the sum of every branch.
 */
export function workflowFundingNeeds(program: WorkflowV2Program): WorkflowFundingNeeds {
  let maxUsdc = 0n;
  let maxWeth = 0n;
  let vaultUsdc = 0n;
  let vaultWeth = 0n;
  let walletUsdc = 0n;
  const payment = program.trigger === T.payment;

  for (const node of program.nodes) {
    if (node.check !== 0) continue;
    let usdc = 0n;
    let weth = 0n;
    let refill = 0n;
    for (const action of node.actions) {
      if (action.kind === A.alert) continue;
      // The validator only allows percentage actions on a payment trigger, where the incoming
      // transfer funds them inside the same run and the origin cap bounds the spend. There is no
      // fixed amount to reserve, so a percentage step never adds a Vault shortfall here; the
      // Vault's per-step balance check is what settles the live amount.
      if (action.unit === U.percent) continue;
      if (action.kind === A.refill) {
        refill += action.amount;
      } else if (action.kind === A.sell) {
        weth += action.amount;
      } else {
        usdc += action.amount;
      }
    }
    if (usdc > maxUsdc) maxUsdc = usdc;
    if (weth > maxWeth) maxWeth = weth;
    if (refill > walletUsdc) walletUsdc = refill;
    // A payment trigger brings the USDC into the Vault before settlement. Other triggers do not.
    if (!payment && usdc > vaultUsdc) vaultUsdc = usdc;
    if (weth > vaultWeth) vaultWeth = weth;
  }

  return { maxUsdc, maxWeth, vaultUsdc, vaultWeth, walletUsdc };
}

/** Returns every reason activation would produce a run that cannot settle. */
export function workflowFundingIssues(
  program: WorkflowV2Program,
  budget: WeeklyBudgetAmounts,
  funds: WorkflowFundingBalances,
): FundingIssue[] {
  const needs = workflowFundingNeeds(program);
  const issues: FundingIssue[] = [];

  if (needs.maxUsdc > program.usdcCap) {
    issues.push({
      code: 'cap-usdc',
      recovery: 'limits',
      message: `The per-run USDC cap is ${amount(program.usdcCap, 6, 'USDC')}, but one run can spend ${amount(needs.maxUsdc, 6, 'USDC')}. Raise the cap or lower the spend.`,
    });
  }
  if (needs.maxWeth > program.wethCap) {
    issues.push({
      code: 'cap-weth',
      recovery: 'limits',
      message: `The per-run WETH cap is ${amount(program.wethCap, 18, 'WETH')}, but one run can sell ${amount(needs.maxWeth, 18, 'WETH')}. Raise the cap or lower the sale.`,
    });
  }
  if (budget.usdc !== 0n && needs.maxUsdc > budget.usdc) {
    issues.push({
      code: 'budget-usdc',
      recovery: 'limits',
      message: `The weekly USDC budget is ${amount(budget.usdc, 6, 'USDC')}, but one run can spend ${amount(needs.maxUsdc, 6, 'USDC')}. Raise the budget to at least ${amount(needs.maxUsdc, 6, 'USDC')} or lower the spend.`,
    });
  }
  if (budget.weth !== 0n && needs.maxWeth > budget.weth) {
    issues.push({
      code: 'budget-weth',
      recovery: 'limits',
      message: `The weekly WETH budget is ${amount(budget.weth, 18, 'WETH')}, but one run can sell ${amount(needs.maxWeth, 18, 'WETH')}. Raise the budget to at least ${amount(needs.maxWeth, 18, 'WETH')} or lower the sale.`,
    });
  }

  const needsVault = needs.vaultUsdc > 0n || needs.vaultWeth > 0n || needs.walletUsdc > 0n;
  if (needsVault && funds.vault === zeroAddress) {
    issues.push({
      code: 'vault-missing',
      recovery: 'account',
      message: 'This wallet has no Vault yet. Open Account & Vault to create it, then fund it.',
    });
  } else {
    if (needs.vaultUsdc > funds.stable) {
      issues.push({
        code: 'vault-usdc',
        recovery: 'account',
        message: `This workflow can spend up to ${amount(needs.vaultUsdc, 6, 'USDC')} in one run, but the Vault holds ${amount(funds.stable, 6, 'USDC')}. Add at least ${amount(needs.vaultUsdc - funds.stable, 6, 'USDC')} to the Vault.`,
      });
    }
    if (needs.vaultWeth > funds.wrapped) {
      issues.push({
        code: 'vault-weth',
        recovery: 'account',
        message: `This workflow can sell up to ${amount(needs.vaultWeth, 18, 'WETH')} in one run, but the Vault holds ${amount(funds.wrapped, 18, 'WETH')}. Add at least ${amount(needs.vaultWeth - funds.wrapped, 18, 'WETH')} to the Vault.`,
      });
    }
  }

  if (needs.walletUsdc > funds.walletStable) {
    issues.push({
      code: 'wallet-usdc',
      recovery: 'account',
      message: `The refill can pull ${amount(needs.walletUsdc, 6, 'USDC')} from your wallet, but the wallet holds ${amount(funds.walletStable, 6, 'USDC')}. Add USDC to the wallet or lower the refill amount.`,
    });
  }

  return issues;
}
