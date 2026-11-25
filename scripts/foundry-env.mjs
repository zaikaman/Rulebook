#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Prepends `~/.foundry/bin` to `PATH` when present so IDE git hooks and Playwright child
 * processes find `forge` and `anvil` even when launched without a login shell `PATH`.
 */
export function ensureFoundryOnPath() {
  const foundryBin = join(homedir(), '.foundry', 'bin');
  if (!existsSync(foundryBin)) return;
  const current = process.env.PATH ?? process.env.Path ?? '';
  const entries = current.split(delimiter).filter(Boolean);
  const listed = entries.some((entry) =>
    process.platform === 'win32'
      ? entry.toLowerCase() === foundryBin.toLowerCase()
      : entry === foundryBin,
  );
  if (listed) return;
  const next = [foundryBin, ...entries].join(delimiter);
  process.env.PATH = next;
  if (process.platform === 'win32' && 'Path' in process.env) {
    process.env.Path = next;
  }
}

/** Resolves a Foundry binary, preferring `envOverride`, then `~/.foundry/bin`, then `PATH`. */
export function resolveFoundryBinary(name, envOverride) {
  const override = envOverride?.trim();
  if (override) return override;
  ensureFoundryOnPath();
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = join(homedir(), '.foundry', 'bin', exe);
  return existsSync(candidate) ? candidate : name;
}
