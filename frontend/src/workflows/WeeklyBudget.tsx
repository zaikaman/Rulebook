import { readWeeklyLimit } from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatUnits } from 'viem';

import {
  Button,
  Callout,
  Dialog,
  ErrorState,
  FactList,
  Field,
  Panel,
  PanelBody,
  PanelHeader,
  PanelHeading,
} from '@/ui';
import {
  readWorkflowV2,
  readWorkflowWeeklyBudget,
  useWorkflowV2Wallet,
  type WorkflowWeeklyBudget as WeeklyBudgetRead,
} from './chainV2';

type WorkflowItem = Awaited<ReturnType<typeof readWorkflowV2>>;
type Wallet = ReturnType<typeof useWorkflowV2Wallet>;

function displayAmount(value: bigint, decimals: number) {
  const [whole, fraction] = formatUnits(value, decimals).split('.');
  const trimmed = fraction?.slice(0, 4).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : (whole ?? '0');
}

function limitLabel(limit: bigint, decimals: number, asset: string) {
  return limit === 0n ? 'Unlimited' : `${displayAmount(limit, decimals)} ${asset}`;
}

function remainingLabel(limit: bigint, remaining: bigint, decimals: number, asset: string) {
  return limit === 0n ? 'Unlimited' : `${displayAmount(remaining, decimals)} ${asset}`;
}

/** The reset instant in the reader's local time, with the time-zone name spelled out. */
function resetLabel(resetsAt: bigint) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(Number(resetsAt) * 1000));
}

function readLimit(value: string, asset: 'USDC' | 'WETH') {
  try {
    return { amount: readWeeklyLimit(value, asset), error: undefined };
  } catch (cause) {
    return {
      amount: undefined,
      error: cause instanceof Error ? cause.message : 'Enter a valid limit.',
    };
  }
}

export function WorkflowWeeklyBudget({ item, wallet }: { item: WorkflowItem; wallet: Wallet }) {
  const [editing, setEditing] = useState(false);
  const budget = useQuery({
    queryKey: ['workflow-v2', 'weekly-budget', item.chain, item.vault, item.id],
    queryFn: () => readWorkflowWeeklyBudget(item.chain, item.vault, item.id),
    refetchInterval: 12_000,
  });
  const editable = !item.closed && !item.staged && item.auth[1] > 0n;
  const facts = budget.data
    ? [
        {
          term: 'USDC weekly limit',
          value: limitLabel(budget.data.usdcLimit, 6, 'USDC'),
        },
        {
          term: 'USDC spent this week',
          value: `${displayAmount(budget.data.usdcSpent, 6)} USDC`,
        },
        {
          term: 'USDC remaining',
          value: remainingLabel(budget.data.usdcLimit, budget.data.usdcRemaining, 6, 'USDC'),
        },
        {
          term: 'WETH weekly limit',
          value: limitLabel(budget.data.wethLimit, 18, 'WETH'),
        },
        {
          term: 'WETH spent this week',
          value: `${displayAmount(budget.data.wethSpent, 18)} WETH`,
        },
        {
          term: 'WETH remaining',
          value: remainingLabel(budget.data.wethLimit, budget.data.wethRemaining, 18, 'WETH'),
        },
        { term: 'Resets', value: resetLabel(budget.data.resetsAt) },
      ]
    : [];

  return (
    <Panel aria-labelledby="weekly-budget-title">
      <PanelHeader>
        <PanelHeading
          title="Weekly spending budget"
          description="Limits apply to every confirmed run this week. The week resets Monday at 00:00 UTC."
          titleId="weekly-budget-title"
        />
        {editable && (
          <Button onClick={() => setEditing(true)} disabled={wallet.busy}>
            Edit weekly budget
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        {budget.isPending ? (
          <p role="status">Reading the weekly budget…</p>
        ) : budget.error ? (
          <ErrorState
            message="The weekly budget could not be read from the Vault."
            detail={budget.error.message}
            chainId={item.chain}
            onRetry={() => void budget.refetch()}
          />
        ) : (
          <FactList items={facts} />
        )}
      </PanelBody>
      {editing && budget.data && (
        <EditWeeklyBudget
          item={item}
          budget={budget.data}
          wallet={wallet}
          close={() => setEditing(false)}
        />
      )}
    </Panel>
  );
}

function EditWeeklyBudget({
  item,
  budget,
  wallet,
  close,
}: {
  item: WorkflowItem;
  budget: WeeklyBudgetRead;
  wallet: Wallet;
  close: () => void;
}) {
  const [usdc, setUsdc] = useState(budget.usdcLimit > 0n ? formatUnits(budget.usdcLimit, 6) : '');
  const [weth, setWeth] = useState(budget.wethLimit > 0n ? formatUnits(budget.wethLimit, 18) : '');
  const usdcRead = readLimit(usdc, 'USDC');
  const wethRead = readLimit(weth, 'WETH');
  const lowersUsdc =
    usdcRead.amount !== undefined && usdcRead.amount > 0n && usdcRead.amount < budget.usdcSpent;
  const lowersWeth =
    wethRead.amount !== undefined && wethRead.amount > 0n && wethRead.amount < budget.wethSpent;
  const ready = usdcRead.amount !== undefined && wethRead.amount !== undefined && !wallet.busy;

  async function save() {
    if (usdcRead.amount === undefined || wethRead.amount === undefined) return;
    if (await wallet.setWeeklyBudget(item, usdcRead.amount, wethRead.amount)) close();
  }

  return (
    <Dialog
      labelledBy="weekly-budget-dialog-title"
      describedBy="weekly-budget-dialog-copy"
      onCancel={close}
      busy={wallet.busy}
      className="app-panel-pad grid gap-4"
    >
      <PanelHeading
        title="Edit weekly budget"
        description="The schedule and inactivity window stay as they are. Spending already recorded this week still counts toward the new limits."
        titleId="weekly-budget-dialog-title"
      />
      <p className="sr-only" id="weekly-budget-dialog-copy">
        Enter an optional weekly limit for USDC and WETH. A blank field is unlimited.
      </p>
      <Field
        label="USDC weekly limit"
        hint="Blank means unlimited for USDC."
        error={usdcRead.error}
      >
        <input
          className="app-input"
          inputMode="decimal"
          autoFocus
          value={usdc}
          aria-invalid={Boolean(usdcRead.error) || undefined}
          onChange={(event) => setUsdc(event.target.value)}
        />
      </Field>
      <Field
        label="WETH weekly limit"
        hint="Blank means unlimited for WETH."
        error={wethRead.error}
      >
        <input
          className="app-input"
          inputMode="decimal"
          value={weth}
          aria-invalid={Boolean(wethRead.error) || undefined}
          onChange={(event) => setWeth(event.target.value)}
        />
      </Field>
      {(lowersUsdc || lowersWeth) && (
        <Callout title="This is below spending already recorded this week">
          <p>
            Remaining {lowersUsdc && lowersWeth ? 'USDC and WETH' : lowersUsdc ? 'USDC' : 'WETH'}{' '}
            stays at zero, so runs that need that asset are skipped until you raise the limit or the
            week resets.
          </p>
        </Callout>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={close} disabled={wallet.busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!ready}>
          {wallet.busy ? 'Confirming…' : 'Save weekly budget'}
        </Button>
      </div>
    </Dialog>
  );
}
