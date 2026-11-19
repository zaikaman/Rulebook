import { agentFactoryAbi, type Address } from '@rulebook/shared';
import { parseAbi } from 'viem';
import { unichainSepolia } from 'viem/chains';

import { AGENT_FACTORY_ADDRESS } from './contracts.js';
import { lasnaPublicClient, unichainPublicClient } from './wagmi.js';

// Successful testnet receipts. These are gas measurements, independent of the fee per gas.
const setupGas = {
  // https://lasna.reactscan.net/tx/0x6cd10c581b151423ec44d180574785188f9f4010b86ef7362e0d688be5b0e66c
  linkVault: 48_293n,
  // https://sepolia.uniscan.xyz/tx/0x396cd64adb9917abcd66aa5c0ac90f9437f4923625cf59f77ee2263dbd9918ee
  deployVault: 2_463_530n,
  // https://sepolia.uniscan.xyz/tx/0x8289d9bc71f74570e806702cc40886c6d1d59f44762b928026579cbe1f2b9c85
  deployMirrorVault: 2_464_719n,
};

const oracleAbi = parseAbi([
  'function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)',
  'function getOperatorFee(uint256 gasUsed) view returns (uint256)',
]);

export async function estimateLasnaSetupFee(owner: Address, hasAgent: boolean) {
  const factory = AGENT_FACTORY_ADDRESS;
  if (!factory) throw new Error('The automation factory is unavailable.');
  const [gasPrice, deployGas] = await Promise.all([
    lasnaPublicClient.getGasPrice(),
    hasAgent
      ? 0n
      : lasnaPublicClient.estimateContractGas({
          address: factory,
          abi: agentFactoryAbi,
          functionName: 'deploy',
          args: [owner],
          account: owner,
        }),
  ]);
  return roundUpFee(gasPrice * (deployGas + setupGas.linkVault));
}

export async function estimateUnichainSetupFee(mirror: boolean) {
  const gas = mirror ? setupGas.deployMirrorVault : setupGas.deployVault;
  const address = unichainSepolia.contracts.gasPriceOracle.address;
  const [gasPrice, oracleCode] = await Promise.all([
    unichainPublicClient.getGasPrice(),
    unichainPublicClient.getCode({ address }),
  ]);
  if (!oracleCode) return roundUpFee(gasPrice * gas);

  // ABI calldata is 324 bytes for a 65-byte wallet signature. Allow up to 128 more
  // bytes for the unsigned EIP-1559 envelope without an access list.
  const unsignedSize = 324n + 128n;
  const [dataFee, operatorFee] = await Promise.all([
    unichainPublicClient.readContract({
      address,
      abi: oracleAbi,
      functionName: 'getL1FeeUpperBound',
      args: [unsignedSize],
    }),
    unichainPublicClient.readContract({
      address,
      abi: oracleAbi,
      functionName: 'getOperatorFee',
      args: [gas],
    }),
  ]);
  return roundUpFee(gasPrice * gas + dataFee + operatorFee);
}

/** Round up to three significant digits without losing precision for small balances. */
export function roundUpFee(value: bigint) {
  const unit = 10n ** BigInt(Math.max(0, value.toString().length - 3));
  return ((value + unit - 1n) / unit) * unit;
}
