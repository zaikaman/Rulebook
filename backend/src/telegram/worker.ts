import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';

import type { TelegramDatabase, TelegramService } from './service.js';

const claims = z.array(z.object({ id: z.string(), lease: z.string().uuid() }));
const destinations = z.array(
  z.object({ chat_id: z.string(), message: z.string(), attempts: z.number() }),
);
const queueMetrics = z.object({
  queued: z.number(),
  oldestSeconds: z.number(),
  failed: z.number(),
  staged: z.number(),
  oldestStagedSeconds: z.number(),
});
const replySchema = z.object({
  ok: z.boolean(),
  error_code: z.number().optional(),
  parameters: z.object({ retry_after: z.number().int().positive().optional() }).optional(),
});

type DeliveryResult = { result: 'sent' | 'blocked' | 'failed' | 'retry'; delay: number };

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string,
  attempts: number,
  transport = fetch,
): Promise<DeliveryResult> {
  const retry = { result: 'retry', delay: Math.min(3600, 15 * 2 ** (attempts - 1)) } as const;
  try {
    const response = await transport(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    const parsed = replySchema.safeParse(await response.json().catch(() => null));
    if (response.ok && parsed.success && parsed.data.ok) return { result: 'sent', delay: 0 };
    const code = parsed.success ? (parsed.data.error_code ?? response.status) : response.status;
    if (code === 403) return { result: 'blocked', delay: 0 };
    if (code === 429) {
      const delay = parsed.success ? parsed.data.parameters?.retry_after : undefined;
      return { result: 'retry', delay: delay ?? retry.delay };
    }
    if (code >= 400 && code < 500 && code !== 408) return { result: 'failed', delay: 0 };
    return retry;
  } catch {
    // Fetch exceptions can contain the bot token via the request URL.
    return retry;
  }
}

interface DeliveryLogger {
  info(details: object, message: string): void;
  warn(message: string): void;
}

export class TelegramWorker {
  private readonly lifetime = new AbortController();

  constructor(
    private readonly db: TelegramDatabase,
    private readonly service: TelegramService,
    private readonly log: DeliveryLogger,
  ) {}

  async run() {
    let nextMaintenance = 0;
    const { signal } = this.lifetime;
    while (!signal.aborted) {
      try {
        await this.service.processNotifications();
      } catch {
        this.log.warn('Telegram notification staging could not be processed');
      }
      try {
        if (Date.now() >= nextMaintenance) {
          const metrics = await this.db.rpc('telegram_maintain', {}, queueMetrics);
          if (metrics.queued || metrics.failed || metrics.staged)
            this.log.info(metrics, 'Telegram delivery queue');
          nextMaintenance = Date.now() + 60_000;
        }
        if (!signal.aborted) {
          const [job] = await this.db.rpc('telegram_claim', {}, claims);
          if (job) {
            const parameters = { p_id: job.id, p_lease: job.lease };
            const [destination] = await this.db.rpc('telegram_prepare', parameters, destinations);
            if (destination) {
              const { result, delay } = await sendTelegramMessage(
                this.service.config.botToken,
                destination.chat_id,
                destination.message,
                destination.attempts,
              );
              await this.db.rpc(
                'telegram_finish',
                { ...parameters, p_result: result, p_delay: delay },
                z.null(),
              );
              if (result === 'failed' || result === 'blocked')
                this.log.warn(`Telegram delivery ${result}`);
            }
          }
        }
      } catch {
        this.log.warn('Telegram worker database operation failed');
      }
      await sleep(1000, undefined, { signal }).catch(() => undefined);
    }
  }

  stop() {
    this.lifetime.abort();
  }
}
