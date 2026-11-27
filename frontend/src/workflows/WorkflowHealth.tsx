import { workflowHealthKey } from '@rulebook/shared';
import type { Address } from 'viem';
import { Link } from 'react-router';

import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import { Badge, FactList, Panel, PanelBody, PanelHeader, PanelHeading } from '@/ui';
import {
  shortRun,
  useWorkflowHealth,
  workflowHealthHref,
  workflowRunStatusLabels,
  type WorkflowHealthItem,
} from './health';

export function WorkflowHealthPanel({
  item,
  owner,
  readOnly = false,
}: {
  readonly item: WorkflowHealthItem;
  readonly owner?: Address;
  readonly readOnly?: boolean;
}) {
  const { mode } = useNetworkMode();
  const { rows, pending, runsUnavailable, creditsUnavailable } = useWorkflowHealth(owner, [item]);
  const view = rows.get(workflowHealthKey(item.chain, item.id));
  if (!view) return null;
  const href = workflowHealthHref(view.health, item.id, view.lastRun?.id, view.chain, mode);
  const readOnlySafeFix =
    view.health.fix === 'run' || view.health.fix === 'activity' || view.health.fix === 'account';
  const showFix = Boolean(href && view.health.fixLabel && (!readOnly || readOnlySafeFix));
  const facts = [
    {
      term: 'Last successful run',
      value: view.lastSuccess ? (
        <Link
          className="app-link"
          to={withNetworkQuery(`${appRoutes.runs}/${view.lastSuccess.id}`, mode)}
        >
          {shortRun(view.lastSuccess.id)}
        </Link>
      ) : (
        'No successful run yet'
      ),
    },
    ...(view.lastRun
      ? [
          {
            term: 'Latest run',
            value: (
              <>
                {workflowRunStatusLabels[view.lastRun.status]}{' '}
                <Link
                  className="app-link"
                  to={withNetworkQuery(`${appRoutes.runs}/${view.lastRun.id}`, mode)}
                >
                  {shortRun(view.lastRun.id)}
                </Link>
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <Panel id="workflow-health" role="region" aria-labelledby="workflow-health-title">
      <PanelHeader>
        <PanelHeading
          title="Workflow health"
          description="What this workflow is doing now, and what to fix if it cannot run."
          titleId="workflow-health-title"
        />
        <Badge tone={view.health.tone}>{view.health.label}</Badge>
      </PanelHeader>
      <PanelBody>
        <p className="app-copy">{view.health.summary}</p>
        <FactList items={facts} />
        {showFix && href ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link className="app-button" to={href}>
              {view.health.fixLabel}
            </Link>
          </div>
        ) : null}
        {pending ? (
          <p className="app-copy" role="status">
            Checking the latest run and credit balances…
          </p>
        ) : null}
        {runsUnavailable ? (
          <p className="app-copy" role="status">
            Run history is unavailable. The status still reflects the on-chain workflow and credit
            state.
          </p>
        ) : null}
        {creditsUnavailable ? (
          <p className="app-copy" role="status">
            Some credit balances could not be checked.
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
