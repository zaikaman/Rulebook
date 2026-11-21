import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';

import { fundingPreflight, type TelegramFundingAlerts } from './fundingAlerts.js';
import type { TelegramDatabase, TelegramService } from './service.js';
import { payoutPreflight, type WorkflowTelegramAlerts } from './workflowAlerts.js';

const claims = z.array(z.object({ id: z.string(), lease: z.string().uuid() }));
const destinations = z.array(
  z.object({
    chat_id: z.string(),
    message: z.string(),
    attempts: z.number(),
    preflight: z.discriminatedUnion('kind', [fundingPreflight, payoutPreflight]).nullish(),
  }),
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
const retryDelay = (attempts: number) => Math.min(3600, 15 * 2 ** (attempts - 1));

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string,
  attempts: number,
  transport = fetch,
): Promise<DeliveryResult> {
  const retry = { result: 'retry', delay: retryDelay(attempts) } as const;
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
    private readonly workflow?: WorkflowTelegramAlerts,
    private readonly funding?: TelegramFundingAlerts,
  ) {}

  async run() {
    await Promise.all([
      this.deliver(),
      this.repeat(1_000, 'Telegram notification staging could not be processed', () =>
        this.service.processNotifications(),
      ),
      this.repeat(10_000, 'Telegram unfinished runs could not be checked', () =>
        this.service.processUnfinished(),
      ),
      this.repeat(5_000, 'Telegram funding checks failed', () => this.funding?.process()),
    ]);
  }

  private async repeat(
    interval: number,
    warning: string,
    work: () => Promise<unknown> | undefined,
  ) {
    const { signal } = this.lifetime;
    while (!signal.aborted) {
      try {
        await work();
      } catch {
        this.log.warn(warning);
      }
      await sleep(interval, undefined, { signal }).catch(() => undefined);
    }
  }

  private async deliver() {
    let nextMaintenance = 0;
    const { signal } = this.lifetime;
    while (!signal.aborted) {
      try {
        if (Date.now() >= nextMaintenance) {
          nextMaintenance = Date.now() + 60_000;
          const metrics = await Promise.allSettled([
            this.db.rpc('telegram_maintain', {}, queueMetrics),
            this.service.operationalMetrics(),
          ]);
          for (const result of metrics) {
            if (result.status === 'rejected') this.log.warn('Telegram queue metrics unavailable');
            else if (result.value && Object.values(result.value).some((value) => value > 0))
              this.log.info(result.value, 'Telegram delivery and monitoring');
          }
        }
        if (!signal.aborted) {
          const [job] = await this.db.rpc(
            'telegram_claim_alert_delivery',
            { p_deployment: this.workflow?.deployment ?? null },
            claims,
          );
          if (job) await this.deliverClaim(job);
        }
      } catch {
        this.log.warn('Telegram worker database operation failed');
      }
      await sleep(1000, undefined, { signal }).catch(() => undefined);
    }
  }

  private async deliverClaim(job: z.infer<typeof claims>[number]) {
    const parameters = { p_id: job.id, p_lease: job.lease };
    let [destination] = await this.db.rpc('telegram_prepare', parameters, destinations);
    if (!destination) return;
    const finish = (result: DeliveryResult['result'] | 'cancelled', delay = 0) =>
      this.db.rpc('telegram_finish', { ...parameters, p_result: result, p_delay: delay }, z.null());
    const alert = destination.preflight;
    let message: string | null | undefined = destination.message;
    if (alert) {
      try {
        if (alert.kind === 'payout') {
          const current = await this.workflow?.stillInGrace(alert);
          message = current === undefined ? undefined : current ? destination.message : null;
        } else {
          message = await this.funding?.currentMessage(alert);
        }
      } catch {
        message = undefined;
        this.log.warn('Telegram alert could not be checked before delivery');
      }
      if (message === undefined) return finish('retry', retryDelay(destination.attempts));
      if (message === null) return finish('cancelled');
      // A balance check may take time. Recheck the user's settings and our lease before sending.
      [destination] = await this.db.rpc('telegram_prepare', parameters, destinations);
      if (!destination) return;
    }
    const { result, delay } = await sendTelegramMessage(
      this.service.config.botToken,
      destination.chat_id,
      message,
      destination.attempts,
    );
    await finish(result, delay);
    if (result === 'failed' || result === 'blocked') this.log.warn(`Telegram delivery ${result}`);
  }

  stop() {
    this.lifetime.abort();
  }
}
