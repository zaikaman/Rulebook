const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** True when the window is shorter than an hour, where Cron1000 is needed and costs ~8×. */
function isTight(seconds: number): boolean {
  return seconds > 0 && seconds < HOUR;
}

function windowCopy(seconds: number): string {
  if (seconds <= 0) return 'on the next tick';
  if (seconds < HOUR) {
    const minutes = Math.max(1, Math.round(seconds / MINUTE));
    return `sometime in each ${minutes}-minute window`;
  }
  if (seconds < DAY) {
    const hours = Math.max(1, Math.round(seconds / HOUR));
    return `sometime in each ${hours}-hour window`;
  }
  const days = Math.max(1, Math.round(seconds / DAY));
  return days === 1 ? 'sometime each day' : `sometime in each ${days}-day window`;
}

export interface ScheduleLabelProps {
  /** The schedule in seconds, from the manifest's `schedule` slot. */
  readonly seconds: string | number | bigint | null | undefined;
}

/**
 * Schedules are approximate windows, not cron promises: the tick that carries the rule can be
 * up to one window late. Tight windows need Cron1000, which costs roughly eight times a
 * Cron10000 subscription, so the cost note is part of the label (FR-021).
 */
export function ScheduleLabel({ seconds }: ScheduleLabelProps) {
  const value = Number(seconds ?? 0);
  const tight = isTight(value);

  return (
    <p data-schedule-window={tight ? 'tight' : 'standard'} className="text-xs text-ink-muted">
      Runs {windowCopy(value)}. A window is approximate: the tick that carries the rule can land
      anywhere inside it.
      {tight ? (
        <span data-cost-note className="mt-1 block text-ink-muted">
          Windows under an hour need the fast cron source, which costs roughly 8× a ten-second
          window&apos;s equivalent. Choose a longer window to keep the credit cheap.
        </span>
      ) : null}
    </p>
  );
}
