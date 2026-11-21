import type { ReactNode } from 'react';

import { Badge } from './Badge.js';
import { Button } from './Button.js';
import { Panel, PanelBody, PanelCopy, PanelHeader, PanelTitle } from './Panel.js';

export interface SyncStateProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly note?: ReactNode;
  readonly badge?: ReactNode;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

/**
 * A panel for data that is still indexing. The title lives inside `role="status"` so an
 * announced "Syncing listing" never depends on a visual-only cue.
 */
export function SyncState({
  title,
  description,
  note,
  badge = 'Indexing',
  onRetry,
  retryLabel = 'Check again',
}: SyncStateProps) {
  return (
    <Panel className="rb-sync">
      <PanelHeader>
        <div className="rb-sync-heading" role="status">
          <span className="rb-sync-mark" aria-hidden="true">
            <span className="rb-sync-pulse" />
          </span>
          <div>
            <PanelTitle>{title}</PanelTitle>
            <PanelCopy>{description}</PanelCopy>
          </div>
        </div>
        {badge ? <Badge tone="info">{badge}</Badge> : null}
      </PanelHeader>
      <PanelBody className="rb-sync-body">
        <div className="rb-sync-track" aria-hidden="true">
          <span />
        </div>
        {note ? <p className="rb-sync-note">{note}</p> : null}
        {onRetry ? (
          <div className="rb-sync-actions">
            <Button onClick={onRetry}>{retryLabel}</Button>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
