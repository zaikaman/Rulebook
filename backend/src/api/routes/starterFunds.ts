import { addressSchema, UNICHAIN_SEPOLIA_CHAIN_ID } from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ServerDeps } from '../../deps.js';
import { sendError } from './errors.js';

const bodySchema = z.object({ owner: addressSchema, vault: addressSchema });

/**
 * Registers `POST /v1/starter-funds`. The claim row is inserted before any transfer is
 * signed, so a repeat or concurrent request gets 409 instead of a second transfer. The vault
 * owner is read from the vault itself, never trusted from the request (T094).
 */
export function registerStarterFundsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/v1/starter-funds', async (request, reply) => {
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
    const { owner, vault } = parsed.data;

    const onchainOwner = await deps.relayer.vaultOwner(vault);
    if (!onchainOwner) {
      return sendError(
        reply,
        404,
        'not_found',
        'That vault could not be read on Unichain Sepolia.',
      );
    }
    if (onchainOwner.toLowerCase() !== owner) {
      return sendError(reply, 403, 'vault_not_owned', 'That vault is not owned by this address.');
    }

    const existing = await deps.repositories.starterFunds.get(owner);
    if (existing) {
      return sendError(reply, 409, 'already_claimed', 'Starter funds were already claimed.');
    }
    const claimed = await deps.repositories.starterFunds.claim(owner, UNICHAIN_SEPOLIA_CHAIN_ID);
    if (!claimed) {
      return sendError(reply, 409, 'already_claimed', 'Starter funds were already claimed.');
    }

    try {
      const transfer = await deps.relayer.sendStarterFunds(vault);
      const txHash = transfer.txHashes[0];
      if (!txHash) throw new Error('Starter funds transfer produced no transaction hash');
      await deps.repositories.starterFunds.complete(owner, {
        // Approve and deposit are two transactions per token; record the deposit that moved it.
        usdc_tx: transfer.txHashes[1] ?? transfer.txHashes[0] ?? null,
        weth_tx: transfer.txHashes[3] ?? transfer.txHashes[2] ?? null,
        amount_usdc: transfer.amountUsdc.toString(),
        amount_weth: transfer.amountWeth.toString(),
      });
      return {
        tx_hash: txHash,
        tx_hashes: transfer.txHashes,
        amount_usdc: transfer.amountUsdc.toString(),
        amount_weth: transfer.amountWeth.toString(),
      };
    } catch (error) {
      // Release the claim so the user can retry; a failed transfer sent nothing.
      await deps.repositories.starterFunds.release(owner).catch(() => undefined);
      request.log.error({ err: error }, 'starter funds transfer failed');
      return sendError(
        reply,
        502,
        'relayer_failed',
        error instanceof Error ? error.message : 'The starter-funds transfer failed.',
      );
    }
  });
}
