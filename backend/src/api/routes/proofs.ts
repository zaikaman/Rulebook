import {
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  type CallbackRecord,
  type TxHash,
} from '@rulebook/shared';
import type { FastifyInstance } from 'fastify';

import type { ChainProof, ProofDestination } from '../../chain/proofSource.js';
import type { CallbackRow } from '../../db/repositories/index.js';
import type { ServerDeps } from '../../deps.js';
import { mapContractError } from '../middleware/errorMap.js';
import { sendError } from './errors.js';

/** A cached proof older than this is not served; the user gets an honest 503 instead. */
const PROOF_CACHE_TTL_SECONDS = 86_400;
const ZERO_TX_HASH = `0x${'0'.repeat(64)}`;

interface ProofRowShape {
  role: 'origin' | 'automation' | 'destination';
  chain_id: number;
  tx_hash: string;
  block_number?: number;
  timestamp?: string;
  explorer_url: string;
  error?: { selector: string; message: string; human: string } | null;
}

function explorerTxUrl(chainId: number, txHash: string): string {
  return `${getChain(chainId).explorerUrl}/tx/${txHash}`;
}

function refusalOf(callback: CallbackRecord): ProofRowShape['error'] {
  if (!callback.error_data || callback.error_data === '0x') return null;
  const mapped = mapContractError(callback.error_data);
  return {
    selector: callback.error_data.slice(0, 10),
    message: callback.error_data,
    human: mapped?.human ?? 'The destination call was refused.',
  };
}

function chainRows(proof: ChainProof): ProofRowShape[] {
  const rows: ProofRowShape[] = [];

  if (proof.origin) {
    rows.push({
      role: 'origin',
      chain_id: proof.origin.chain_id,
      tx_hash: proof.origin.tx_hash,
      ...(proof.origin.block_number !== undefined
        ? { block_number: proof.origin.block_number }
        : {}),
      ...(proof.origin.timestamp ? { timestamp: proof.origin.timestamp } : {}),
      explorer_url: explorerTxUrl(proof.origin.chain_id, proof.origin.tx_hash),
    });
  }

  rows.push({
    role: 'automation',
    chain_id: proof.automation.chain_id,
    tx_hash: proof.automation.tx_hash,
    ...(proof.automation.block_number !== undefined
      ? { block_number: proof.automation.block_number }
      : {}),
    ...(proof.automation.timestamp ? { timestamp: proof.automation.timestamp } : {}),
    explorer_url: explorerTxUrl(proof.automation.chain_id, proof.automation.tx_hash),
  });

  for (const destination of proof.destinations) {
    rows.push(destinationRow(destination));
  }

  return rows;
}

function destinationRow(destination: ProofDestination): ProofRowShape {
  return {
    role: 'destination',
    chain_id: destination.chain_id,
    tx_hash: destination.tx_hash,
    ...(destination.block_number !== undefined
      ? { block_number: destination.block_number }
      : {}),
    ...(destination.timestamp ? { timestamp: destination.timestamp } : {}),
    explorer_url: explorerTxUrl(destination.chain_id, destination.tx_hash),
    error: refusalOf(destination.callback),
  };
}

function cacheAgeSeconds(callbacks: readonly CallbackRow[]): number {
  const writtenAt = callbacks
    .map((callback) => Date.parse(callback.recorded_at))
    .filter((value) => Number.isFinite(value));
  if (writtenAt.length === 0) return 0;
  return Math.max(0, Math.floor((Date.now() - Math.max(...writtenAt)) / 1000));
}

function cacheRows(
  origin: { chain_id: number | null; origin_tx: string | null } | undefined,
  callbacks: readonly CallbackRow[],
): ProofRowShape[] {
  const rows: ProofRowShape[] = [];

  if (origin?.origin_tx) {
    const chainId = origin.chain_id ?? UNICHAIN_SEPOLIA_CHAIN_ID;
    rows.push({
      role: 'origin',
      chain_id: chainId,
      tx_hash: origin.origin_tx,
      explorer_url: explorerTxUrl(chainId, origin.origin_tx),
    });
  }

  const first = callbacks[0];
  if (first) {
    rows.push({
      role: 'automation',
      chain_id: LASNA_CHAIN_ID,
      tx_hash: first.reactive_tx_hash,
      block_number: first.block_number,
      explorer_url: explorerTxUrl(LASNA_CHAIN_ID, first.reactive_tx_hash),
    });
  }

  for (const callback of callbacks) {
    if (!callback.destination_tx_hash) continue;
    const chainId = Number(callback.destination_chain_id) || UNICHAIN_SEPOLIA_CHAIN_ID;
    rows.push({
      role: 'destination',
      chain_id: chainId,
      tx_hash: callback.destination_tx_hash,
      explorer_url: explorerTxUrl(chainId, callback.destination_tx_hash),
      error:
        callback.error_data && callback.error_data !== '0x'
          ? {
              selector: callback.error_data.slice(0, 10),
              message: callback.error_data,
              human:
                mapContractError(callback.error_data)?.human ??
                'The destination call was refused.',
            }
          : null,
    });
  }

  return rows;
}

/**
 * Registers `GET /v1/proofs/:reactiveTxHash`. The chain is read first via `getCallbacks`; the
 * callback cache is used only when that read fails, and then the response is labelled `cache`
 * with its age — a cached proof is never presented as live (T136, T137).
 */
export function registerProofRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get<{ Params: { reactiveTxHash: string } }>(
    '/v1/proofs/:reactiveTxHash',
    async (request, reply) => {
      const hash = request.params.reactiveTxHash.toLowerCase();
      if (!/^0x[a-f0-9]{64}$/.test(hash)) {
        return sendError(reply, 400, 'invalid_query', 'reactiveTxHash must be a 32-byte hash');
      }

      let chainFailure = false;
      if (deps.proofSource) {
        try {
          const proof = await deps.proofSource.read(hash as TxHash);
          if (!proof) {
            return sendError(
              reply,
              404,
              'not_found',
              'No callback recorded yet; validators may not have written it',
            );
          }

          await deps.repositories.callbacks.upsert(
            proof.callbacks.map((callback) => ({
              reactive_tx_hash: hash,
              callback_index: callback.callback_index,
              reactive_contract: callback.reacting_contract,
              destination_chain_id: String(callback.destination_chain_id),
              destination_tx_hash:
                callback.destination_tx_hash === ZERO_TX_HASH
                  ? null
                  : callback.destination_tx_hash,
              error_data: callback.error_data || null,
              block_number: callback.block_number,
              recorded_at: new Date().toISOString(),
            })),
          );

          return {
            reactive_tx: proof.reactive_tx,
            source: 'chain' as const,
            cache_age_seconds: null,
            latency_ms: proof.latency_ms,
            rows: chainRows(proof),
          };
        } catch {
          chainFailure = true;
        }
      }

      const callbacks = await deps.repositories.callbacks.listForTx(hash);
      if (callbacks.length === 0) {
        if (chainFailure) {
          return sendError(
            reply,
            503,
            'proof_unavailable',
            'Both the chain read and the callback cache are unavailable',
          );
        }
        return sendError(
          reply,
          404,
          'not_found',
          'No callback recorded yet; validators may not have written it',
        );
      }

      const age = cacheAgeSeconds(callbacks);
      if (chainFailure && age > PROOF_CACHE_TTL_SECONDS) {
        return sendError(
          reply,
          503,
          'proof_unavailable',
          'The chain read failed and the cached proof is too old to trust',
        );
      }

      const originEvents = await deps.repositories.ruleEvents.listByTx(hash);
      const originEvent = originEvents.find((event) => event.origin_tx);
      const origin = originEvent
        ? { chain_id: originEvent.origin_chain_id ?? null, origin_tx: originEvent.origin_tx ?? null }
        : undefined;

      const rows = cacheRows(origin, callbacks);
      if (rows.length === 0) {
        return sendError(reply, 404, 'not_found', 'No proof rows could be built');
      }

      return {
        reactive_tx: hash,
        source: 'cache' as const,
        cache_age_seconds: age,
        latency_ms: null,
        rows,
      };
    },
  );
}
