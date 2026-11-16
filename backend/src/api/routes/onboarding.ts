import {
  addressSchema,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type OnboardingStep,
} from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ServerDeps } from '../../deps.js';
import { sendError } from './errors.js';

const bodySchema = z.object({
  owner: addressSchema,
  vault_authorization: z
    .object({
      deadline: z
        .string()
        .regex(/^[0-9]+$/)
        .transform(BigInt),
      signature: z
        .string()
        .regex(/^0x[0-9a-fA-F]{130}$/)
        .transform((value) => value as `0x${string}`),
    })
    .optional(),
});

type Warn = (error: unknown, message: string) => void;

/**
 * Registers `POST /v1/onboarding`. The relayer deploys the Agent (Lasna) and the Vault
 * (Unichain Sepolia) with the requested owner, then funds execution credit and gas. The
 * Vault creation requires an owner EIP-712 authorization bound to the Unichain factory. The
 * first call creates/resolves the Agent; the client signs for that Agent and resumes onboarding.
 */
export function registerOnboardingRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/v1/onboarding', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_request', parsed.error.issues[0]?.message ?? 'body');
    }
    if (!deps.relayer) {
      return sendError(
        reply,
        503,
        'relayer_unavailable',
        'The sponsor relayer is not configured in this environment.',
      );
    }
    const { owner, vault_authorization: vaultAuthorization } = parsed.data;
    if (!deps.onboardingLimiter.allow(owner)) {
      return sendError(
        reply,
        429,
        'rate_limited',
        'Too many onboarding attempts for this address. Try again in a minute.',
      );
    }

    const relayer = deps.relayer;
    const steps: OnboardingStep[] = [];
    const warn: Warn = (error, message) => request.log.warn({ err: error }, message);
    const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);

    let agent: `0x${string}`;
    try {
      const existing = await relayer.agentOf(owner);
      if (existing) {
        agent = existing.toLowerCase() as `0x${string}`;
        steps.push({ name: 'agent', status: 'skipped', chain_id: LASNA_CHAIN_ID });
      } else {
        const deployment = await relayer.deployAgent(owner);
        agent = deployment.address.toLowerCase() as `0x${string}`;
        steps.push({
          name: 'agent',
          status: 'confirmed',
          tx_hash: deployment.txHash,
          chain_id: LASNA_CHAIN_ID,
        });
        await persist(warn, () =>
          deps.repositories.agents.upsert({
            address: agent,
            owner,
            factory:
              deps.config.AGENT_FACTORY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
            created_tx: deployment.txHash,
            created_block: deployment.blockNumber,
            rule_count: 0,
            chain_id: LASNA_CHAIN_ID,
          }),
        );
      }
    } catch (error) {
      request.log.error({ err: error }, 'agent deployment failed');
      return sendError(
        reply,
        502,
        'relayer_failed',
        error instanceof Error ? error.message : 'The sponsor transaction failed.',
      );
    }

    let vault: `0x${string}` | null = null;
    try {
      const existingVault = await relayer.vaultOf(owner);
      vault = existingVault ? (existingVault.toLowerCase() as `0x${string}`) : null;
      if (vault) {
        steps.push({ name: 'vault', status: 'skipped', chain_id: UNICHAIN_SEPOLIA_CHAIN_ID });
      } else if (!vaultAuthorization) {
        steps.push({
          name: 'vault',
          status: 'skipped',
          chain_id: UNICHAIN_SEPOLIA_CHAIN_ID,
          error: 'owner_signature_required',
        });
      } else {
        const deployment = await relayer.deployVault(
          owner,
          agent,
          vaultAuthorization.deadline,
          vaultAuthorization.signature,
        );
        vault = deployment.address.toLowerCase() as `0x${string}`;
        steps.push({
          name: 'vault',
          status: 'confirmed',
          tx_hash: deployment.txHash,
          chain_id: UNICHAIN_SEPOLIA_CHAIN_ID,
        });
        await persist(warn, () =>
          deps.repositories.vaults.upsert({
            address: vault as `0x${string}`,
            owner,
            agent,
            chain_id: UNICHAIN_SEPOLIA_CHAIN_ID,
            created_tx: deployment.txHash,
            mirror_mode: false,
            allowed_token_in: unichain.usdc,
            allowed_token_out: unichain.weth,
            max_spend_per_run: null,
            paused: false,
          }),
        );
      }
    } catch (error) {
      warn(error, 'vault deployment failed');
      steps.push({
        name: 'vault',
        status: 'failed',
        chain_id: UNICHAIN_SEPOLIA_CHAIN_ID,
        error: error instanceof Error ? error.message : 'Vault deployment failed',
      });
    }

    if (!vault) {
      if (steps.some((step) => step.error === 'owner_signature_required')) {
        steps.push(await fund(warn, relayer, owner, agent));
      }
      return { setup_state: 'agent_only' as const, steps, agent };
    }

    const link = await relayer.agentLink(agent, UNICHAIN_SEPOLIA_CHAIN_ID);
    const linked = link !== null && link.toLowerCase() === vault.toLowerCase();
    steps.push({
      name: 'link',
      status: 'skipped',
      chain_id: LASNA_CHAIN_ID,
      ...(linked ? {} : { error: 'owner_signature_required' }),
    });

    steps.push(await fund(warn, relayer, owner, agent));

    return {
      setup_state: linked ? ('complete' as const) : ('partial' as const),
      steps,
      agent,
      vault,
    };
  });
}

/** Gas top-up and reserve credit are one user-visible step; each is independently retryable. */
async function fund(
  warn: Warn,
  relayer: NonNullable<ServerDeps['relayer']>,
  owner: `0x${string}`,
  agent: `0x${string}`,
): Promise<OnboardingStep> {
  try {
    const gas = await relayer.topUpUserGas(owner);
    const reserves = await relayer.fundAgentReserves(agent);
    const txHash = reserves?.txHash ?? gas?.txHash;
    return {
      name: 'fund_credit',
      status: txHash ? 'confirmed' : 'skipped',
      chain_id: LASNA_CHAIN_ID,
      ...(txHash ? { tx_hash: txHash } : {}),
    };
  } catch (error) {
    warn(error, 'sponsor funding step failed');
    return {
      name: 'fund_credit',
      status: 'failed',
      chain_id: LASNA_CHAIN_ID,
      error: error instanceof Error ? error.message : 'Sponsor funding failed',
    };
  }
}

/** The read model is a cache; a write failure must not undo a confirmed on-chain deployment. */
async function persist(warn: Warn, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    warn(error, 'failed to persist onboarding row');
  }
}
