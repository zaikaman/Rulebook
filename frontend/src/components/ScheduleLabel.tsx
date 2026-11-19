const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
 * Lasna checks hourly rules every 100 blocks and daily or longer rules every 10,000 blocks.
 */
export function ScheduleLabel({ seconds }: ScheduleLabelProps) {
  const value = Number(seconds ?? 0);
  const tight = value > 0 && value < DAY;

  return (
    <p data-schedule-window={tight ? 'tight' : 'standard'} className="text-xs text-ink-muted">
      Runs {windowCopy(value)}. Lasna checks for due rules every {tight ? '100' : '10,000'} blocks.
      {tight ? (
        <span data-cost-note className="mt-1 block text-ink-muted">
          Hourly rules use more monitoring credit because Lasna checks them more often.
        </span>
      ) : null}
    </p>
  );
}
