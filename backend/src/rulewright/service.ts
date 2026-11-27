import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

import {
  automationChainFor,
  decodeWorkflowV2,
  fundsChainsFor,
  isFundsChain,
  isSameNetworkMode,
  networkModeForChain,
  resolveRulewrightNetwork,
  rulewrightChallengeSchema,
  rulewrightJobIdSchema,
  rulewrightRequestSchema,
  rulewrightResultSchema,
  rulewrightSignIn,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowProgramValidatorV2Abi,
  workflowVaultFactoryV2Abi,
  type Address,
  type FundsChainId,
  type NetworkMode,
  type RulewrightChallenge,
  type RulewrightRequest,
  type RulewrightResult,
} from '@rulebook/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { BaseError, ContractFunctionRevertedError, type Hex } from 'viem';
import { z } from 'zod';

import { clientFor, type ChainClients } from '../chain/clients.js';
import { verifyWalletSignature } from '../chain/verifySignature.js';
import type { GeminiConfig } from '../config.js';
import { generateRulewrightDraft } from './gemini.js';

const challengeSeconds = 5 * 60;
const sessionSeconds = 20 * 60;
const timestamp = () => Math.floor(Date.now() / 1000);
const date = (seconds: number) => new Date(seconds * 1000).toISOString();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const databaseTimeout = () => AbortSignal.timeout(5000);

const admissionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued'), id: rulewrightJobIdSchema }),
  z.object({ status: z.literal('unauthorized') }),
  z.object({ status: z.literal('limited') }),
  z.object({ status: z.literal('busy') }),
]);
const jobsSchema = z
  .array(
    z.object({
      id: rulewrightJobIdSchema,
      lease: z.string().uuid(),
      payload: rulewrightRequestSchema,
    }),
  )
  .max(1);

export class RulewrightService {
  private queueChanged = new AbortController();
  private readonly factories: Partial<Record<FundsChainId, Address>>;

  constructor(
    private readonly db: SupabaseClient,
    private readonly clients: ChainClients,
    factoryOrFactories: Partial<Record<FundsChainId, Address>> | Address,
    private readonly provider: GeminiConfig,
  ) {
    this.factories =
      typeof factoryOrFactories === 'string'
        ? { [UNICHAIN_SEPOLIA_CHAIN_ID]: factoryOrFactories }
        : factoryOrFactories;
  }

  hasNetwork(network: NetworkMode): boolean {
    return fundsChainsFor(network).some((chain) => Boolean(this.factories[chain]));
  }

  private targetNetworkFor(request: Pick<RulewrightRequest, 'network' | 'draft'>): NetworkMode {
    return resolveRulewrightNetwork(request);
  }

  async ready(network?: NetworkMode) {
    if (
      network
        ? !this.hasNetwork(network)
        : !this.hasNetwork('testnet') && !this.hasNetwork('mainnet')
    ) {
      return false;
    }
    const { error } = await this.db
      .from('rulewright_sessions')
      .select('nonce', { head: true })
      .limit(0)
      .abortSignal(databaseTimeout());
    return !error;
  }

  async challenge(
    owner: Address,
    origin: string,
    network: NetworkMode = 'testnet',
  ): Promise<RulewrightChallenge> {
    const nonce = `0x${randomBytes(32).toString('hex')}` as const;
    const expiresAt = timestamp() + challengeSeconds;
    const { error } = await this.db
      .from('rulewright_sessions')
      .insert({ nonce, owner, origin, network, expires_at: date(expiresAt) })
      .abortSignal(databaseTimeout());
    if (error) throw new Error('Rulewright could not create the wallet challenge.');
    return { nonce, owner, origin, network, expiresAt };
  }

  async signIn(nonce: Hex, origin: string, signature: Hex) {
    const { data, error } = await this.db
      .from('rulewright_sessions')
      .select('nonce,owner,origin,network,expires_at')
      .eq('nonce', nonce)
      .eq('origin', origin)
      .is('token_hash', null)
      .gt('expires_at', date(timestamp()))
      .abortSignal(databaseTimeout())
      .maybeSingle();
    if (error) throw new Error('Rulewright could not read the wallet challenge.');
    if (!data) return null;
    const challenge = rulewrightChallengeSchema.parse({
      ...data,
      expiresAt: Date.parse(data.expires_at) / 1000,
    });
    if (!this.hasNetwork(challenge.network)) return null;
    const verification = {
      address: challenge.owner,
      message: rulewrightSignIn(challenge),
      signature,
    };
    let verified: boolean;
    try {
      verified = await verifyWalletSignature(
        this.clients,
        verification,
        automationChainFor(challenge.network),
      );
    } catch {
      throw new Error('Rulewright could not verify the wallet signature.');
    }
    if (!verified) return null;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = timestamp() + sessionSeconds;
    const consumed = await this.db
      .from('rulewright_sessions')
      .update({ token_hash: hash(token), expires_at: date(expiresAt) })
      .eq('nonce', nonce)
      .eq('origin', origin)
      .is('token_hash', null)
      .gt('expires_at', date(timestamp()))
      .select('nonce')
      .abortSignal(databaseTimeout())
      .maybeSingle();
    if (consumed.error) throw new Error('Rulewright could not create the wallet session.');
    return consumed.data ? { token, expiresAt } : null;
  }

  async enqueue(token: string, origin: string, request: RulewrightRequest) {
    if (
      request.draft?.originChain &&
      !isSameNetworkMode(request.draft.chain, request.draft.originChain)
    ) {
      throw new Error('Rulewright draft originChain must stay in the same network mode as chain.');
    }
    if (
      request.network &&
      request.draft &&
      (networkModeForChain(request.draft.chain) !== request.network ||
        (request.draft.originChain &&
          networkModeForChain(request.draft.originChain) !== request.network))
    ) {
      throw new Error('Rulewright draft network does not match the selected network mode.');
    }
    const targetNetwork = this.targetNetworkFor(request);
    if (!this.hasNetwork(targetNetwork)) {
      return { status: 'network_unavailable' as const, network: targetNetwork };
    }
    const { data, error } = await this.db
      .rpc('rulewright_enqueue', {
        p_session: hash(token),
        p_origin: origin,
        p_payload: { ...request, network: targetNetwork },
        p_network: targetNetwork,
      })
      .abortSignal(databaseTimeout());
    if (error) throw new Error('Rulewright could not queue the workflow request.');
    const result = admissionSchema.parse(data);
    if (result.status === 'queued') {
      this.queueChanged.abort();
      this.queueChanged = new AbortController();
    }
    return result;
  }

  async job(token: string, origin: string, id: string) {
    const tokenHash = hash(token);
    const session = await this.db
      .from('rulewright_sessions')
      .select('owner')
      .eq('token_hash', tokenHash)
      .eq('origin', origin)
      .gt('expires_at', date(timestamp()))
      .abortSignal(databaseTimeout())
      .maybeSingle();
    if (session.error) throw new Error('Rulewright could not verify the wallet session.');
    if (!session.data) return { status: 'unauthorized' as const };

    const { data, error } = await this.db
      .from('rulewright_jobs')
      .select('result')
      .eq('id', id)
      .eq('session_hash', tokenHash)
      .gt('expires_at', date(timestamp()))
      .abortSignal(databaseTimeout())
      .maybeSingle();
    if (error) throw new Error('Rulewright could not load the workflow request.');
    if (!data) return { status: 'missing' as const };
    return data.result
      ? { status: 'complete' as const, result: rulewrightResultSchema.parse(data.result) }
      : { status: 'pending' as const };
  }

  async run(log: FastifyBaseLogger, signal: AbortSignal) {
    await Promise.all([this.work(log, signal), this.work(log, signal), this.clean(log, signal)]);
  }

  private async work(log: FastifyBaseLogger, signal: AbortSignal) {
    while (!signal.aborted) {
      const wake = AbortSignal.any([signal, this.queueChanged.signal]);
      try {
        const { data, error } = await this.db
          .rpc('rulewright_claim')
          .abortSignal(databaseTimeout());
        if (error) throw new Error('claim');
        const [job] = jobsSchema.parse(data);
        if (job && !signal.aborted) {
          let result: RulewrightResult;
          const targetNetwork = this.targetNetworkFor(job.payload);
          if (!this.hasNetwork(targetNetwork)) {
            result = {
              type: 'error',
              message: `Rulewright is not configured for ${targetNetwork}.`,
            };
          } else {
            try {
              const scopedPayload: RulewrightRequest = { ...job.payload, network: targetNetwork };
              const availableChains = fundsChainsFor(targetNetwork).filter((chain) =>
                Boolean(this.factories[chain]),
              );
              result = await generateRulewrightDraft(
                this.provider,
                scopedPayload,
                (encoded, abort) => this.validate(encoded, targetNetwork, abort),
                signal,
                availableChains,
              );
            } catch (err) {
              log.warn(
                { err: err instanceof Error ? err.name : 'unknown' },
                'Rulewright draft validation failed',
              );
              result = {
                type: 'error',
                message: 'Rulewright could not validate the draft. Try again shortly.',
              };
            }
          }
          if (signal.aborted) return;
          const finished = await this.db
            .from('rulewright_jobs')
            .update({ payload: null, result, lease: null, lease_expires_at: null })
            .eq('id', job.id)
            .eq('lease', job.lease)
            .gt('expires_at', date(timestamp()))
            .abortSignal(databaseTimeout());
          if (finished.error) throw new Error('finish');
          continue;
        }
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.name : 'unknown' },
          'Rulewright could not process its queue',
        );
      }
      await pause(10_000, undefined, { signal: wake }).catch(() => undefined);
    }
  }

  private async clean(log: FastifyBaseLogger, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const { error } = await this.db.rpc('rulewright_cleanup').abortSignal(databaseTimeout());
        if (error) throw new Error('cleanup');
      } catch {
        log.warn('Rulewright could not clean up expired jobs');
      }
      await pause(30_000, undefined, { signal }).catch(() => undefined);
    }
  }

  private async validate(encoded: Hex, targetNetwork: NetworkMode, signal: AbortSignal) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(deadline.reason);
        if (deadline.aborted) return abort();
        deadline.addEventListener('abort', abort, { once: true });
        this.validateOnChain(encoded, targetNetwork)
          .then(resolve, reject)
          .finally(() => deadline.removeEventListener('abort', abort));
      });
      return true;
    } catch (error) {
      if (
        error instanceof BaseError &&
        error.walk((cause) => cause instanceof ContractFunctionRevertedError) instanceof
          ContractFunctionRevertedError
      ) {
        return false;
      }
      throw error;
    }
  }

  private async validateOnChain(encoded: Hex, targetNetwork: NetworkMode) {
    const decoded = decodeWorkflowV2(encoded);
    if (!isFundsChain(decoded.chain) || !isFundsChain(decoded.originChain)) {
      throw new Error(`Unsupported workflow chain ${decoded.chain}`);
    }
    if (
      networkModeForChain(decoded.chain) !== targetNetwork ||
      networkModeForChain(decoded.originChain) !== targetNetwork
    ) {
      throw new Error(
        `Workflow chains (${decoded.chain}, ${decoded.originChain}) do not match ${targetNetwork}.`,
      );
    }
    const factory = this.factories[decoded.chain];
    if (!factory) throw new Error(`No Vault factory configured for chain ${decoded.chain}`);
    const client = clientFor(this.clients, decoded.chain);
    const validator = await client.readContract({
      address: factory,
      abi: workflowVaultFactoryV2Abi,
      functionName: 'validator',
    });
    await client.readContract({
      address: validator,
      abi: workflowProgramValidatorV2Abi,
      functionName: 'validateProgram',
      args: [encoded],
    });
  }
}
