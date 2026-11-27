import { RefreshIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ReactNode } from 'react';

export interface PresetOption {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly title?: string;
  readonly active?: boolean;
  readonly onSelect: () => void;
}

export interface PresetStripProps {
  readonly label: ReactNode;
  readonly value?: ReactNode;
  readonly unit?: string;
  readonly delta?: string | null;
  readonly loading?: boolean;
  readonly refreshing?: boolean;
  readonly error?: string;
  readonly onRefresh?: () => void;
  readonly refreshLabel?: string;
  readonly options: readonly PresetOption[];
  readonly groupLabel: string;
}

/**
 * Compact inline reference readout with relative quick-fill preset chips.
 */
export function PresetStrip({
  label,
  value,
  unit,
  delta,
  loading = false,
  refreshing = false,
  error,
  onRefresh,
  refreshLabel = 'Refresh pool price',
  options,
  groupLabel,
}: PresetStripProps) {
  return (
    <div className="rb-preset-strip" data-state={loading ? 'loading' : error ? 'error' : 'ready'}>
      <div className="rb-preset-strip__header">
        <span className="rb-preset-strip__label">{label}</span>
        {!loading && !error && onRefresh ? (
          <button
            type="button"
            className="rb-preset-strip__refresh"
            aria-label={refreshLabel}
            data-refreshing={refreshing || undefined}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="rb-preset-strip__value-row">
        {loading ? (
          <span
            className="rb-preset-strip__skeleton"
            role="status"
            aria-label="Reading pool price"
          />
        ) : error ? (
          <>
            <span className="rb-preset-strip__error" role="status">
              {error}
            </span>
            {onRefresh ? (
              <button
                type="button"
                className="rb-preset-strip__retry"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? 'Retrying…' : 'Retry'}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className="rb-preset-strip__readout">
              <strong>{value}</strong>
              {unit ? <span className="rb-preset-strip__unit">{unit}</span> : null}
            </span>
            {delta ? <span className="rb-preset-strip__delta">{delta}</span> : null}
          </>
        )}
      </div>
      <div className="rb-preset-strip__chips" role="group" aria-label={groupLabel}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="rb-preset-chip"
            aria-pressed={Boolean(option.active)}
            aria-label={option.ariaLabel}
            title={option.title}
            disabled={loading || Boolean(error)}
            onClick={option.onSelect}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
