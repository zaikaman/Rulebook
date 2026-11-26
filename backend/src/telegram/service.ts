import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  LASNA_CHAIN_ID,
  REACTIVE_MAINNET_CHAIN_ID,
  telegramSettingsSchema,
  telegramSignIn,
  workflowAgentFactoryV2Abi,
  workflowAgentV2Abi,
  type Address,
  type AutomationChainId,
  type TelegramChallenge,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Hex } from 'viem';
import { z } from 'zod';

import { clientFor, type ChainClients } from '../chain/clients.js';
import type { TelegramConfig, TelegramFactoryTarget } from '../config.js';
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
    automationChain?: AutomationChainId,
  ): Promise<boolean>;
}

export function telegramOwnership(
  clients: ChainClients,
  targets: readonly TelegramFactoryTarget[],
): TelegramOwnership {
  return {
    async verify(agent, owner, challenge, signature, automationChain = LASNA_CHAIN_ID) {
      const checks = targets.filter((target) => target.chainId === automationChain);
      if (checks.length === 0) return false;
      const client = clientFor(clients, automationChain);
      const registrations = await Promise.allSettled(
        checks.map(({ address }) =>
          client.readContract({
            address,
            abi: workflowAgentFactoryV2Abi,
            functionName: 'agentOf',
            args: [owner],
          }),
        ),
      );
      const matched = checks.filter((_, index) => {
        const entry = registrations[index];
        return entry?.status === 'fulfilled' && entry.value.toLowerCase() === agent;
      });
      if (matched.length === 0) {
        if (registrations.some((entry) => entry.status === 'rejected'))
          throw new Error('Could not read the automation account factory.');
        return false;
      }
      const currentOwner = await client.readContract({
        address: agent,
        abi: workflowAgentV2Abi,
        functionName: 'owner',
      });
      if (currentOwner.toLowerCase() !== owner) return false;
      return client.verifyTypedData({
        address: owner,
        signature,
        ...telegramSignIn(agent, challenge, automationChain),
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

  async createSession(
    nonce: string,
    agent: Address,
    value: string,
    expiresAt: number | null,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    const { error } = await this.client
      .from('telegram_sessions')
      .insert({
        nonce,
        automation_chain: automationChain,
        agent,
        token_hash: hash(value),
        expires_at: expiresAt === null ? null : timestamp(expiresAt),
      })
      .abortSignal(AbortSignal.timeout(8_000));
    if (error?.code === '23505') return false;
    if (error) throw new Error(`Telegram session could not be stored (${error.code})`);
    return true;
  }

  async session(
    agent: Address,
    value: string,
    browser = false,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    const sessionHash = hash(value);
    const query = this.client
      .from('telegram_sessions')
      .select('expires_at')
      .eq('automation_chain', automationChain)
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

  async forgetBrowser(
    agent: Address,
    value: string,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    const { error } = await this.client
      .from('telegram_sessions')
      .update({ token_hash: hash(token()), expires_at: timestamp(clock() + CHALLENGE_SECONDS) })
      .eq('automation_chain', automationChain)
      .eq('agent', agent)
      .eq('token_hash', hash(value))
      .is('expires_at', null)
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error(`Telegram browser session could not be revoked (${error.code})`);
  }
}

export class TelegramService {
  private readonly workflowAlertList: readonly WorkflowTelegramAlerts[];

  constructor(
    readonly config: TelegramConfig,
    private readonly db: Pick<
      TelegramDatabase,
      'rpc' | 'createSession' | 'session' | 'forgetBrowser'
    >,
    private readonly ownership: TelegramOwnership,
    workflowAlerts?: WorkflowTelegramAlerts | readonly WorkflowTelegramAlerts[],
  ) {
    this.workflowAlertList = !workflowAlerts
      ? []
      : Array.isArray(workflowAlerts)
        ? workflowAlerts
        : [workflowAlerts];
  }

  private runnerFor(automationChain: AutomationChainId) {
    return this.workflowAlertList.find((runner) => runner.automationChain === automationChain);
  }

  private challengeProof(
    agent: Address,
    owner: Address,
    nonce: Hex,
    expiresAt: number,
    automationChain: AutomationChainId,
    browser?: true,
  ) {
    return createHmac('sha256', this.config.webhookSecret)
      .update(
        JSON.stringify([
          'rulebook-telegram-challenge',
          this.config.appOrigin,
          automationChain,
          agent,
          owner,
          nonce,
          expiresAt,
          ...(browser ? ['trust-browser'] : []),
        ]),
      )
      .digest('hex');
  }

  challenge(
    agent: Address,
    owner: Address,
    browser?: true,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ): TelegramChallenge {
    const nonce = `0x${randomBytes(32).toString('hex')}` as const;
    const expiresAt = clock() + CHALLENGE_SECONDS;
    return {
      nonce,
      expiresAt,
      origin: this.config.appOrigin,
      proof: this.challengeProof(agent, owner, nonce, expiresAt, automationChain, browser),
      ...(browser ? { browser } : {}),
    };
  }

  async signIn(
    agent: Address,
    owner: Address,
    challenge: TelegramChallenge,
    signature: Hex,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    const { nonce, expiresAt, origin, proof, browser } = challenge;
    if (
      expiresAt <= clock() ||
      origin !== this.config.appOrigin ||
      !sameSecret(
        proof,
        this.challengeProof(agent, owner, nonce, expiresAt, automationChain, browser),
      )
    )
      return null;
    if (
      !(await this.ownership.verify(agent, owner, challenge, signature, automationChain)) ||
      expiresAt <= clock()
    )
      return null;
    const value = token();
    const sessionExpiry = browser ? null : clock() + SESSION_SECONDS;
    if (!(await this.db.createSession(nonce, agent, value, sessionExpiry, automationChain))) {
      return null;
    }
    return { token: value, expiresAt: sessionExpiry };
  }

  session(
    agent: Address,
    value: string,
    browser: boolean,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    return this.db.session(agent, value, browser, automationChain);
  }

  forgetBrowser(
    agent: Address,
    value: string,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    return this.db.forgetBrowser(agent, value, automationChain);
  }

  async status(
    agent: Address,
    session: string,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    const runner = this.runnerFor(automationChain);
    if (runner) {
      return this.db.rpc(
        'telegram_alert_status',
        {
          p_deployment: runner.deployment,
          p_agent: agent,
          p_session: session,
          p_automation_chain: automationChain,
        },
        telegramSettingsSchema,
      );
    }
    return this.db.rpc(
      'telegram_notification_status',
      { p_agent: agent, p_session: session, p_automation_chain: automationChain },
      telegramSettingsSchema,
    );
  }

  ready(workflow = false, automationChain?: AutomationChainId) {
    if (automationChain !== undefined) {
      if (!workflow && automationChain === REACTIVE_MAINNET_CHAIN_ID) {
        return Promise.resolve(false);
      }
      if (!this.config.factoryTargets.some((target) => target.chainId === automationChain)) {
        return Promise.resolve(false);
      }
    }
    if (workflow) {
      const hasRunner = automationChain
        ? Boolean(this.runnerFor(automationChain))
        : this.workflowAlertList.length > 0;
      if (!hasRunner) return Promise.resolve(false);
    }
    const rpc = workflow ? 'telegram_operational_ready' : 'telegram_notifications_ready';
    return this.db.rpc(rpc, {}, z.boolean());
  }

  async pair(
    agent: Address,
    session: { hash: string; expiresAt: number | null },
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
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
        p_automation_chain: automationChain,
      },
      z.boolean(),
    );
    return accepted
      ? { url: `https://t.me/${this.config.botUsername}?start=${code}`, expiresAt }
      : null;
  }

  confirm(
    agent: Address,
    session: string,
    pairingId: string,
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    return this.db.rpc(
      'telegram_pair_confirm',
      {
        p_agent: agent,
        p_session: session,
        p_pairing: pairingId,
        p_automation_chain: automationChain,
      },
      z.boolean(),
    );
  }

  disconnect(agent: Address, automationChain: AutomationChainId = LASNA_CHAIN_ID) {
    return this.db.rpc(
      'telegram_disconnect',
      { p_agent: agent, p_automation_chain: automationChain },
      z.null(),
    );
  }

  async preferences(
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
    automationChain: AutomationChainId = LASNA_CHAIN_ID,
  ) {
    if (body.fundingAlerts !== undefined || body.actionAlerts !== undefined) {
      if (!this.runnerFor(automationChain)) return false;
      return this.db.rpc(
        'telegram_set_alert_preferences',
        {
          p_agent: agent,
          p_funding: body.fundingAlerts ?? null,
          p_action: body.actionAlerts ?? null,
          p_automation_chain: automationChain,
        },
        z.boolean(),
      );
    }
    if (body.workflowId) {
      const runner = this.runnerFor(automationChain);
      if (!runner) return false;
      return this.db.rpc(
        'telegram_set_workflow_preference',
        {
          p_deployment: runner.deployment,
          p_agent: agent,
          p_workflow: body.workflowId,
          p_preference: body.preference,
          p_automation_chain: automationChain,
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
        p_automation_chain: automationChain,
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

  test(agent: Address, automationChain: AutomationChainId = LASNA_CHAIN_ID) {
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
        p_automation_chain: automationChain,
      },
      z.boolean(),
    );
  }

  async processNotifications() {
    if (this.workflowAlertList.length === 0) return;
    const results = await Promise.allSettled(
      this.workflowAlertList.map((runner) => runner.process()),
    );
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Some workflow Telegram alerts were deferred');
    }
  }

  async processUnfinished() {
    if (this.workflowAlertList.length === 0) return;
    await Promise.all(this.workflowAlertList.map((runner) => runner.processUnfinished()));
  }

  async operationalMetrics() {
    if (this.workflowAlertList.length === 0) return undefined;
    const metricSchema = z.object({
      overdueFundingChecks: z.number(),
      pendingWorkflowAlerts: z.number(),
      oldestWorkflowSeconds: z.number(),
    });
    const list = await Promise.all(
      this.workflowAlertList.map((runner) =>
        this.db.rpc(
          'telegram_operational_metrics',
          { p_deployment: runner.deployment },
          metricSchema,
        ),
      ),
    );
    return list.reduce(
      (acc, next) => ({
        overdueFundingChecks: acc.overdueFundingChecks + next.overdueFundingChecks,
        pendingWorkflowAlerts: acc.pendingWorkflowAlerts + next.pendingWorkflowAlerts,
        oldestWorkflowSeconds: Math.max(acc.oldestWorkflowSeconds, next.oldestWorkflowSeconds),
      }),
      { overdueFundingChecks: 0, pendingWorkflowAlerts: 0, oldestWorkflowSeconds: 0 },
    );
  }
}
