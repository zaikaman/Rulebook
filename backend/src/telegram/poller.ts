import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';

import type { TelegramService } from './service.js';
import { handleTelegramUpdate, type TelegramReply } from './updates.js';
import { sendTelegramMessage } from './worker.js';

const updateBatch = z.object({
  ok: z.literal(true),
  result: z.array(z.object({ update_id: z.number().int().nonnegative().safe() }).passthrough()),
});
const rateLimit = z.object({
  parameters: z.object({ retry_after: z.number().int().positive().safe() }),
});

interface PollLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** The local backend can receive updates without exposing an inbound HTTPS endpoint. */
export class TelegramPoller {
  private readonly lifetime = new AbortController();

  constructor(
    private readonly service: Pick<TelegramService, 'config' | 'webhook'>,
    private readonly log: PollLogger,
    private readonly transport = fetch,
  ) {}

  async run() {
    const { signal } = this.lifetime;
    const { botToken } = this.service.config;
    let offset: number | undefined;
    let connected = false;
    while (!signal.aborted) {
      let delay = 5_000;
      try {
        const response = await this.transport(
          `https://api.telegram.org/bot${botToken}/getUpdates`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ offset, timeout: 25, limit: 20, allowed_updates: ['message'] }),
            redirect: 'error',
            signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
          },
        );
        const payload: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const { result } = updateBatch.parse(payload);
          if (!connected) this.log.info('Telegram polling is receiving updates');
          connected = true;
          if (result.length === 0) offset = undefined;
          for (const update of result.sort((a, b) => a.update_id - b.update_id)) {
            if (signal.aborted) return;
            const reply = await handleTelegramUpdate(this.service, update);
            if (reply) await this.sendReply(reply, signal);
            offset = update.update_id + 1;
          }
          continue;
        }
        if (response.status === 401 || response.status === 404) {
          this.log.warn('Telegram polling stopped because the bot token was rejected');
          return;
        }
        if (response.status === 409) {
          this.log.warn('Telegram polling conflicts with a webhook or another polling process');
          delay = 30_000;
        } else if (response.status === 429) {
          const parsed = rateLimit.safeParse(payload);
          if (parsed.success) delay = parsed.data.parameters.retry_after * 1000;
          this.log.warn('Telegram is rate limiting incoming updates');
        } else {
          this.log.warn('Telegram could not return incoming updates');
        }
      } catch {
        // Network errors can include the token in the request URL.
        if (!signal.aborted) this.log.warn('Telegram could not process incoming updates');
      }
      connected = false;
      await sleep(delay, undefined, { signal }).catch(() => undefined);
    }
  }

  private async sendReply({ chatId, text }: TelegramReply, signal: AbortSignal) {
    const { botToken } = this.service.config;
    const send = (attempt: number) =>
      sendTelegramMessage(botToken, String(chatId), text, attempt, this.transport);
    let delivery = await send(1);
    if (delivery.result === 'retry' && delivery.delay <= 30) {
      await sleep(delivery.delay * 1000, undefined, { signal }).catch(() => undefined);
      if (signal.aborted) return;
      delivery = await send(2);
    }
    if (delivery.result !== 'sent') this.log.warn('Telegram command reply failed');
  }

  stop() {
    this.lifetime.abort();
  }
}
