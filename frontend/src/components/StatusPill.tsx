export type RuleStatus = 'active' | 'paused' | 'cancelled' | 'latched' | 'silent';

const STYLES: Record<RuleStatus, string> = {
  active: 'bg-active/15 text-active border-active/40',
  paused: 'bg-paused/15 text-paused border-paused/40',
  cancelled: 'bg-cancelled/15 text-cancelled border-cancelled/40',
  latched: 'bg-latched/15 text-latched border-latched/50',
  silent: 'bg-silent/15 text-silent border-silent/50',
};

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
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
