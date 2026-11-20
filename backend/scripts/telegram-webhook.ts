import { healthSchema, telegramAvailabilitySchema } from '@rulebook/shared';
import { z } from 'zod';

import { loadConfig } from '../src/config.js';

const result = z.object({ ok: z.literal(true), result: z.unknown() });

async function main() {
  const config = loadConfig().telegram;
  if (!config) throw new Error('Configure the Telegram backend settings first.');
  if (config.updates === 'polling')
    throw new Error('Set TELEGRAM_UPDATES=webhook before registering a webhook.');
  const argument = process.argv[2];
  if (!argument) throw new Error('Pass the public HTTPS origin of the Rulebook backend.');
  const api = new URL(argument);
  if (api.protocol !== 'https:' || api.origin !== argument)
    throw new Error('Pass an HTTPS origin without a trailing slash or path.');

  async function request(url: URL | string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok)
      throw new Error(`Request failed${response ? ` with HTTP ${response.status}` : ''}.`);
    return response.json().catch(() => null);
  }

  const [health, availability] = await Promise.all([
    request(new URL('/health', api)).then((payload) => healthSchema.safeParse(payload)),
    request(new URL('/v1/telegram/availability', api)).then((payload) =>
      telegramAvailabilitySchema.safeParse(payload),
    ),
  ]);
  if (
    !health.success ||
    health.data.status !== 'ok' ||
    !health.data.indexer.cursors.length ||
    !availability.success ||
    !availability.data.available
  ) {
    throw new Error(
      'The backend, indexer, and Telegram configuration must be healthy before registering the webhook.',
    );
  }

  async function botRequest(method: string, body?: object) {
    const payload = await request(`https://api.telegram.org/bot${config!.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const parsed = result.safeParse(payload);
    if (!parsed.success) throw new Error(`Telegram ${method} failed.`);
    return parsed.data.result;
  }

  const identity = z.object({ username: z.string() }).safeParse(await botRequest('getMe'));
  if (
    !identity.success ||
    identity.data.username.toLowerCase() !== config.botUsername.toLowerCase()
  ) {
    throw new Error('TELEGRAM_BOT_USERNAME does not match the configured token.');
  }
  const url = new URL('/v1/telegram/webhook', api).href;
  await botRequest('setWebhook', {
    url,
    secret_token: config.webhookSecret,
    allowed_updates: ['message'],
  });
  const webhookInfo = z
    .object({ url: z.literal(url) })
    .safeParse(await botRequest('getWebhookInfo'));
  if (!webhookInfo.success) throw new Error('The registered webhook URL could not be verified.');
  console.log(`Registered @${identity.data.username} webhook at ${url}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Telegram webhook registration failed.');
  process.exitCode = 1;
});
