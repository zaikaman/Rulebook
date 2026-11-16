/**
 * Reactive system-contract surface used by the proof page. `getCallbacks` is the authoritative
 * source for the automation → destination half of a proof; it is read from Lasna, never from
 * our indexer (Constitution V, SC-005).
 */
export const systemContractAbi = [
  {
    type: 'function',
    name: 'getCallbacks',
    stateMutability: 'view',
    inputs: [{ name: 'reactiveTxHash', type: 'uint256' }],
    outputs: [
      {
        name: 'records',
        type: 'tuple[]',
        components: [
          { name: 'blockNumber', type: 'uint256' },
          { name: 'reactingContract', type: 'address' },
          { name: 'callbackIndex', type: 'uint256' },
          { name: 'destinationChainId', type: 'uint256' },
          { name: 'destinationTxHash', type: 'uint256' },
          { name: 'errorData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;
