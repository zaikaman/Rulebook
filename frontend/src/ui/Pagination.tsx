import { Button } from './Button.js';
import { Toolbar } from './Toolbar.js';

export function Pagination({
  label,
  previous,
  next,
  onPage,
  firstPage,
  busy = false,
}: {
  readonly label: string;
  readonly previous?: string | null;
  readonly next?: string | null;
  readonly onPage: (cursor: string | null) => void;
  readonly firstPage?: boolean;
  readonly busy?: boolean;
}) {
  if (!previous && !next && !firstPage) return null;
  return (
    <nav aria-label={label}>
      <Toolbar>
        {firstPage ? (
          <Button disabled={busy} onClick={() => onPage(null)}>
            Back to first page
          </Button>
        ) : (
          <>
            <Button disabled={busy || !previous} onClick={() => previous && onPage(previous)}>
              Previous
            </Button>
            <Button disabled={busy || !next} onClick={() => next && onPage(next)}>
              Next
            </Button>
          </>
        )}
      </Toolbar>
    </nav>
  );
}
