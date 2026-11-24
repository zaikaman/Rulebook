import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { sendTelegramMessage } from '../src/telegram/worker.js';

/**
 * Best-effort completion ping for the coding agent working in this repository.
 *
 * The bot token and the database credentials come from `backend/.env` (the backend's own
 * configuration). The recipient is the chat that paired with that bot under the configured
 * Telegram username, so no chat id is stored in the repository.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_NOTIFY_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/)
    .default('ThinhDinh1706'),
});

const accountsSchema = z.array(
  z.object({ chat_id: z.string().nullable(), profile: z.string().nullable() }),
);

function git(args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function summaryArgument(): string | undefined {
  const args = process.argv.slice(2);
  const inline = args.find((argument) => argument.startsWith('--summary='));
  if (inline) return inline.slice('--summary='.length);
  const index = args.indexOf('--summary');
  return index >= 0 ? args[index + 1] : undefined;
}

function composeMessage(summary: string | undefined, username: string) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(['log', '-1', '--format=%h %s']);
  const changes = git(['status', '--porcelain', '--untracked-files=normal'])
    ?.split('\n')
    .filter(Boolean).length;
  const cleaned = summary?.replace(/\s+/g, ' ').trim().slice(0, 800);
  return [
    'Rulebook agent finished a task.',
    `Task: ${cleaned || 'No summary provided.'}`,
    `Project: ${basename(repoRoot)}${branch ? ` (${branch})` : ''}`,
    head ? `Head: ${head}` : undefined,
    `Working tree: ${changes ? `${changes} changed file${changes === 1 ? '' : 's'}` : 'clean'}`,
    `Delivered to @${username} at ${new Date().toISOString()}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
    .slice(0, 4_000);
}

async function pairedChats(
  url: string,
  serviceRoleKey: string,
  username: string,
): Promise<string[]> {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const label = `@${username}`.toLowerCase();
  // Narrow with ILIKE, then compare exactly: the username may contain `_`, which ILIKE treats
  // as a wildcard.
  const { data, error } = await client
    .from('telegram_accounts')
    .select('chat_id, profile')
    .ilike('profile', label)
    .not('chat_id', 'is', null)
    .eq('blocked', false)
    .abortSignal(AbortSignal.timeout(8_000));
  if (error) throw new Error(`Could not read paired Telegram accounts (${error.code}).`);
  const accounts = accountsSchema.parse(data ?? []);
  return [
    ...new Set(
      accounts
        .filter((account) => account.profile?.toLowerCase() === label && account.chat_id)
        .map((account) => account.chat_id as string),
    ),
  ];
}

async function main() {
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    const missing = env.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Set ${missing} in backend/.env before using this notifier.`);
  }
  const { TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env.data;
  const username = env.data.TELEGRAM_NOTIFY_USERNAME;
  const chats = await pairedChats(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, username);
  if (!chats.length) {
    throw new Error(
      `No Telegram chat is paired as @${username}. Connect the bot from Account & Vault in Rulebook first.`,
    );
  }
  const message = composeMessage(summaryArgument(), username);
  const failures: string[] = [];
  for (const chatId of chats) {
    const { result } = await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, message, 1);
    if (result !== 'sent') failures.push(result);
  }
  if (failures.length) {
    throw new Error(
      `Telegram did not accept the completion ping (${failures.join(', ')}). Check the bot token and the paired chat.`,
    );
  }
  console.log(`Sent the completion ping to @${username}.`);
}

main().catch((error: unknown) => {
  // Fetch errors can contain the bot token in their message, so only our own messages are shown.
  console.error(
    error instanceof Error && error.message
      ? error.message
      : 'The completion ping could not be sent.',
  );
  process.exitCode = 1;
});
