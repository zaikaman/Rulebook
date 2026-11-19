export type RuleStatus =
  'active' | 'paused' | 'cancelled' | 'latched' | 'silent' | 'waiting-funds' | 'replaced';

export const STATUS_LABELS: Record<RuleStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  latched: 'Fired — needs reset',
  silent: 'Silent — no execution credit',
  'waiting-funds': 'Waiting for funds',
  replaced: 'Replaced',
};

/**
 * Renders a rule's status. `latched` and `silent` deliberately never share the `active` style:
 * a fired rule or an unfunded account must not look like a running automation.
 */
export function StatusPill({ status }: { readonly status: RuleStatus }) {
  return (
    <span data-status={status} className="app-tag app-status">
      {STATUS_LABELS[status]}
    </span>
  );
}
