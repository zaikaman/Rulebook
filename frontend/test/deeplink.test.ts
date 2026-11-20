import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface VercelConfig {
  readonly buildCommand: string;
  readonly rewrites: ReadonlyArray<{ readonly source: string; readonly destination: string }>;
}

const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as VercelConfig;

function servedBySpaRewrite(pathname: string): boolean {
  return config.rewrites.some(
    (rewrite) =>
      rewrite.destination === '/index.html' && new RegExp(`^${rewrite.source}$`).test(pathname),
  );
}

describe('Vercel SPA routing', () => {
  it('serves the proof deep link to index.html', () => {
    expect(servedBySpaRewrite(`/proof/0x${'a'.repeat(64)}`)).toBe(true);
  });

  it('serves the rule detail deep link to index.html', () => {
    expect(servedBySpaRewrite('/rules/0x1111111111111111111111111111111111111111/3')).toBe(true);
  });

  it('runs the build from the Vercel project root (frontend)', () => {
    expect(config.buildCommand).toBe('npm run build');
  });
});
