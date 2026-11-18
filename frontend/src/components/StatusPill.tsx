export type RuleStatus = 'active' | 'paused' | 'cancelled' | 'latched' | 'silent';

const LABELS: Record<RuleStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  latched: 'Fired — needs reset',
  silent: 'Silent — no execution credit',
};

/**
 * Renders a rule's status. `latched` and `silent` deliberately never share the `active` style:
 * a fired rule or an unfunded account must not look like a running automation.
 */
export function StatusPill({ status }: { readonly status: RuleStatus }) {
  return (
    <span data-status={status} className="app-tag app-status">
      {LABELS[status]}
    </span>
  );
}
