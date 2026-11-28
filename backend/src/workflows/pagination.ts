import { createHash } from 'node:crypto';
import { z } from 'zod';

export const workflowPageSize = 24;

export function pageScope(...filters: unknown[]) {
  return createHash('sha256').update(JSON.stringify(filters)).digest('base64url');
}

export function readPageCursor<T extends z.ZodRawShape>(
  value: string,
  shape: z.ZodObject<T>,
  scope: string,
  allowLegacy = false,
) {
  const cursor = shape
    .extend({ scope: z.string().optional() })
    .parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (cursor.scope !== scope && !(allowLegacy && cursor.scope === undefined)) {
    throw new Error('Cursor scope does not match.');
  }
  return cursor;
}

export function encodePageCursor(scope: string, position: object) {
  return Buffer.from(JSON.stringify({ ...position, scope })).toString('base64url');
}

export function bidirectionalPage<T>(
  rows: T[],
  cursor: { before?: boolean } | undefined,
  token: (row: T, before: boolean) => string,
) {
  const before = Boolean(cursor?.before);
  const extra = rows.length > workflowPageSize;
  const items = rows.slice(0, workflowPageSize);
  if (before) items.reverse();
  const first = items[0];
  const last = items.at(-1);
  return {
    items,
    previousCursor: first && (before ? extra : cursor) ? token(first, true) : null,
    nextCursor: last && (before ? cursor : extra) ? token(last, false) : null,
  };
}
