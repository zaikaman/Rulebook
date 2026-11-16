import { LASNA_CHAIN_ID, UNICHAIN_SEPOLIA_CHAIN_ID, getChain } from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';

import type { ServerDeps } from '../../deps.js';
import { mapContractError } from '../middleware/errorMap.js';
import { sendError } from './errors.js';

interface ProofRowShape {
  role: 'origin' | 'automation' | 'destination';
  chain_id: number;
  tx_hash: string;
  block_number?: number;
  timestamp?: string;
  explorer_url: string;
  error?: { selector: string; message: string; human: string } | null;
}

/**
 * Registers `GET /v1/proofs/:reactiveTxHash`. Phase 2 serves the callback cache; Phase 5 adds
 * the chain-first `getCallbacks` read in front of it.
 */
export function registerProofRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{ Params: { reactiveTxHash: string } }>(
    '/v1/proofs/:reactiveTxHash',
    async (request, reply) => {
      const hash = request.params.reactiveTxHash.toLowerCase();
      if (!/^0x[a-f0-9]{64}$/.test(hash)) {
        return sendError(reply, 400, 'invalid_query', 'reactiveTxHash must be a 32-byte hash');
      }

      const callbacks = await deps.repositories.callbacks.listForTx(hash);
      if (callbacks.length === 0) {
        return sendError(
          reply,
          404,
          'not_found',
          'No callback recorded yet; validators may not have written it',
        );
      }

      const lasna = getChain(LASNA_CHAIN_ID);
      const unichain = getChain(UNICHAIN_SEPOLIA_CHAIN_ID);
      const rows: ProofRowShape[] = [
        {
          role: 'automation',
          chain_id: LASNA_CHAIN_ID,
          tx_hash: hash,
          block_number: callbacks[0]?.block_number,
          explorer_url: `${lasna.explorerUrl}/tx/${hash}`,
        },
      ];

      for (const callback of callbacks) {
        if (!callback.destination_tx_hash) continue;
        const mapped = callback.error_data ? mapContractError(callback.error_data) : null;
        rows.push({
          role: 'destination',
          chain_id: Number(callback.destination_chain_id) || UNICHAIN_SEPOLIA_CHAIN_ID,
          tx_hash: callback.destination_tx_hash,
          explorer_url: `${unichain.explorerUrl}/tx/${callback.destination_tx_hash}`,
          error: callback.error_data
            ? {
                selector: callback.error_data.slice(0, 10),
                message: callback.error_data,
                human: mapped?.human ?? 'The destination call was refused.',
              }
            : null,
        });
      }

      return {
        reactive_tx: hash,
        source: 'cache',
        cache_age_seconds: 0,
        rows,
      };
    },
  );
}
