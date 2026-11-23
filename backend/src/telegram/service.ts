import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  telegramSettingsSchema,
  telegramSignIn,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  type Address,
  type TelegramChallenge,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Hex } from 'viem';
import { z } from 'zod';

import type { ChainClients } from '../chain/clients.js';
import type { TelegramConfig } from '../config.js';
import type { WorkflowTelegramAlerts } from './workflowAlerts.js';

const CHALLENGE_SECONDS = 5 * 60;
const SESSION_SECONDS = 20 * 60;
const PAIRING_SECONDS = 5 * 60;
const clock = () => Math.floor(Date.now() / 1000);
const timestamp = (seconds: number) => new Date(seconds * 1000).toISOString();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const storedSession = z.object({ expires_at: z.string().nullable() });

export function sameSecret(actual: unknown, expected: string): boolean {
  return (
    typeof actual === 'string' &&
    timingSafeEqual(Buffer.from(hash(actual)), Buffer.from(hash(expected)))
  );
}

export interface TelegramOwnership {
  verify(
    agent: Address,
    owner: Address,
    challenge: TelegramChallenge,
    signature: Hex,
  ): Promise<boolean>;
}

export function telegramOwnership(
  clients: ChainClients,
  factories: readonly Address[],
): TelegramOwnership {
  return {
    async verify(agent, owner, challenge, signature) {
      const registrations = await Promise.allSettled(
        factories.map((factory) =>
          clients.lasna.readContract({
            address: factory,
            abi: workflowAgentFactoryV2Abi,
            functionName: 'agentOf',
            args: [owner],
          }),
        ),
      );
      if (
        !registrations.some(
          (entry) => entry.status === 'fulfilled' && entry.value.toLowerCase() === agent,
        )
      ) {
        if (registrations.some((entry) => entry.status === 'rejected'))
          throw new Error('Could not read the automation account factory.');
        return false;
      }
      const currentOwner = await clients.lasna.readContract({
        address: agent,
        abi: workflowAgentV2Abi,
        functionName: 'owner',
      });
      if (currentOwner.toLowerCase() !== owner) return false;
      return clients.lasna.verifyTypedData({
        address: owner,
        signature,
        ...telegramSignIn(agent, challenge),
      });
    },
  };
}

export class TelegramDatabase {
  constructor(private readonly client: SupabaseClient) {}

  async rpc<T>(
    name: string,
    params: Record<string, unknown>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const { data, error } = await this.client
      .rpc(name, params)
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error(`Telegram database operation ${name} failed (${error.code})`);
    return schema.parse(data);
  }

  async createSession(nonce: string, agent: Address, value: string, expiresAt: number | null) {
    const { error } = await this.client
      .from('telegram_sessions')
      .insert({
        nonce,
        agent,
        token_hash: hash(value),
        expires_at: expiresAt === null ? null : timestamp(expiresAt),
      })
      .abortSignal(AbortSignal.timeout(8_000));
    if (error?.code === '23505') return false;
    if (error) throw new Error(`Telegram session could not be stored (${error.code})`);
    return true;
  }

  async session(agent: Address, value: string, browser = false) {
    const sessionHash = hash(value);
    const query = this.client
      .from('telegram_sessions')
      .select('expires_at')
      .eq('agent', agent)
      .eq('token_hash', sessionHash);
    const { data, error } = await (
      browser ? query.is('expires_at', null) : query.gt('expires_at', timestamp(clock()))
    )
      .abortSignal(AbortSignal.timeout(8_000))
      .maybeSingle();
    if (error) throw new Error(`Telegram session could not be read (${error.code})`);
    if (!data) return null;
    const expiry = storedSession.parse(data).expires_at;
    return { hash: sessionHash, expiresAt: expiry === null ? null : Date.parse(expiry) / 1000 };
  }

  async forgetBrowser(agent: Address, value: string) {
    const { error } = await this.client
      .from('telegram_sessions')
      // Invalidate the credential but keep the consumed nonce until its challenge cannot be replayed.
      .update({ token_hash: hash(token()), expires_at: timestamp(clock() + CHALLENGE_SECONDS) })
      .eq('agent', agent)
      .eq('token_hash', hash(value))
      .is('expires_at', null)
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error(`Telegram browser session could not be revoked (${error.code})`);
  }
}

export class TelegramService {
  constructor(
    readonly config: TelegramConfig,
    private readonly db: Pick<
      TelegramDatabase,
      'rpc' | 'createSession' | 'session' | 'forgetBrowser'
    >,
    private readonly ownership: TelegramOwnership,
    private readonly workflowAlerts?: WorkflowTelegramAlerts,
  ) {}

  private challengeProof(
    agent: Address,
    owner: Address,
    nonce: Hex,
    expiresAt: number,
    browser?: true,
  ) {
    return createHmac('sha256', this.config.webhookSecret)
      .update(
        JSON.stringify([
          'rulebook-telegram-challenge',
          this.config.appOrigin,
          agent,
          owner,
          nonce,
          expiresAt,
          ...(browser ? ['trust-browser'] : []),
        ]),
      )
      .digest('hex');
  }

  challenge(agent: Address, owner: Address, browser?: true): TelegramChallenge {
    const nonce = `0x${randomBytes(32).toString('hex')}` as const;
    const expiresAt = clock() + CHALLENGE_SECONDS;
    return {
      nonce,
      expiresAt,
      origin: this.config.appOrigin,
      proof: this.challengeProof(agent, owner, nonce, expiresAt, browser),
      ...(browser ? { browser } : {}),
    };
  }

  async signIn(agent: Address, owner: Address, challenge: TelegramChallenge, signature: Hex) {
    const { nonce, expiresAt, origin, proof, browser } = challenge;
    if (
      expiresAt <= clock() ||
      origin !== this.config.appOrigin ||
      !sameSecret(proof, this.challengeProof(agent, owner, nonce, expiresAt, browser))
    )
      return null;
    if (!(await this.ownership.verify(agent, owner, challenge, signature)) || expiresAt <= clock())
      return null;
    const value = token();
    const sessionExpiry = browser ? null : clock() + SESSION_SECONDS;
    if (!(await this.db.createSession(nonce, agent, value, sessionExpiry))) return null;
    return { token: value, expiresAt: sessionExpiry };
  }

  session(agent: Address, value: string, browser: boolean) {
    return this.db.session(agent, value, browser);
  }

  forgetBrowser(agent: Address, value: string) {
    return this.db.forgetBrowser(agent, value);
  }

  status(agent: Address, session: string) {
    if (this.workflowAlerts) {
      return this.db.rpc(
        'telegram_alert_status',
        { p_deployment: this.workflowAlerts.deployment, p_agent: agent, p_session: session },
        telegramSettingsSchema,
      );
    }
    return this.db.rpc(
      'telegram_notification_status',
      { p_agent: agent, p_session: session },
      telegramSettingsSchema,
    );
  }

  ready(workflow = false) {
    if (workflow && !this.workflowAlerts) return Promise.resolve(false);
    const rpc = workflow ? 'telegram_operational_ready' : 'telegram_notifications_ready';
    return this.db.rpc(rpc, {}, z.boolean());
  }

  async pair(agent: Address, session: { hash: string; expiresAt: number | null }) {
    const code = token();
    const pairingExpiry = clock() + PAIRING_SECONDS;
    const expiresAt = Math.floor(Math.min(pairingExpiry, session.expiresAt ?? pairingExpiry));
    const accepted = await this.db.rpc(
      'telegram_pair_begin',
      {
        p_agent: agent,
        p_session: session.hash,
        p_token: hash(code),
        p_expiry: timestamp(expiresAt),
      },
      z.boolean(),
    );
    return accepted
      ? { url: `https://t.me/${this.config.botUsername}?start=${code}`, expiresAt }
      : null;
  }

  confirm(agent: Address, session: string, pairingId: string) {
    return this.db.rpc(
      'telegram_pair_confirm',
      { p_agent: agent, p_session: session, p_pairing: pairingId },
      z.boolean(),
    );
  }

  disconnect(agent: Address) {
    return this.db.rpc('telegram_disconnect', { p_agent: agent }, z.null());
  }

  preferences(
    agent: Address,
    body: {
      enabled?: boolean;
      fundingAlerts?: boolean;
      actionAlerts?: boolean;
      defaultMode?: string;
      ruleId?: string;
      workflowId?: string;
      preference?: string;
    },
  ) {
    if (body.fundingAlerts !== undefined || body.actionAlerts !== undefined) {
      if (!this.workflowAlerts) return Promise.resolve(false);
      return this.db.rpc(
        'telegram_set_alert_preferences',
        {
          p_agent: agent,
          p_funding: body.fundingAlerts ?? null,
          p_action: body.actionAlerts ?? null,
        },
        z.boolean(),
      );
    }
    if (body.workflowId) {
      if (!this.workflowAlerts) return Promise.resolve(false);
      return this.db.rpc(
        'telegram_set_workflow_preference',
        {
          p_deployment: this.workflowAlerts.deployment,
          p_agent: agent,
          p_workflow: body.workflowId,
          p_preference: body.preference,
        },
        z.boolean(),
      );
    }
    return this.db.rpc(
      'telegram_set_preferences',
      {
        p_agent: agent,
        p_enabled: body.enabled ?? null,
        p_mode: body.defaultMode ?? null,
        p_rule: null,
        p_preference: body.preference ?? null,
      },
      z.boolean(),
    );
  }

  webhook(updateId: number, chatId: number, profile: string, startCode: string | null) {
    return this.db.rpc(
      'telegram_webhook',
      {
        p_update: updateId,
        p_chat: String(chatId),
        p_profile: profile,
        p_token: startCode ? hash(startCode) : null,
        p_stop: startCode === null,
      },
      z.boolean(),
    );
  }

  test(agent: Address) {
    return this.db.rpc(
      'telegram_enqueue',
      {
        p_agent: agent,
        p_chain: null,
        p_tx: null,
        p_index: null,
        p_rule: null,
        p_time: null,
        p_message: 'Test message from Rulebook. Your Telegram connection is working.',
      },
      z.boolean(),
    );
  }

  async processNotifications() {
    await this.workflowAlerts?.process();
  }

  processUnfinished() {
    return this.workflowAlerts?.processUnfinished();
  }

  operationalMetrics() {
    if (!this.workflowAlerts) return undefined;
    return this.db.rpc(
      'telegram_operational_metrics',
      { p_deployment: this.workflowAlerts.deployment },
      z.object({
        overdueFundingChecks: z.number(),
        pendingWorkflowAlerts: z.number(),
        oldestWorkflowSeconds: z.number(),
      }),
    );
  }
}
