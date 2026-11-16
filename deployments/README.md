# Deployments

Every deployment is recorded here. A deploy that exists only in a terminal history did not
happen (constitution, Principle V).

Each network file is a JSON object:

```json
{
  "chainId": 1301,
  "name": "Unichain Sepolia",
  "explorer": "https://sepolia.uniscan.xyz",
  "contracts": [
    {
      "name": "VaultFactory",
      "address": "0x...",
      "commit": "6ae8330",
      "deployer": "0x...",
      "explorerUrl": "https://sepolia.uniscan.xyz/address/0x...",
      "deployedAt": "2026-11-17T00:00:00Z"
    }
  ]
}
```

Rules:

- One entry per deployed contract, appended by the deploy script (`contracts/script/Deploy.s.sol`).
- `commit` is the SHA the bytecode was built from. If you cannot name the SHA, you cannot
  name the contract.
- Never record a private key, seed phrase, or RPC URL containing an API key here.
- Verified addresses from `IDEA.md` §22 are reference constants, not deployments of ours;
  they live in `packages/shared/src/chains.ts` instead.
