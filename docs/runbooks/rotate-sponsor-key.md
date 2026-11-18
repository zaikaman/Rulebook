# Rotate the sponsor key

The sponsor signs onboarding and starter-funds transactions. Its address holds no ownership
role on user Agents or Vaults. Rotation leaves the indexer and user withdrawals available.

1. For planned rotation, pause new sponsor requests and let accepted transactions settle.
   Record pending hashes and the onboarding or starter-funds stage for each. For compromise,
   remove the Heroku `SPONSOR_PRIVATE_KEY` config var immediately and secure any remaining
   sponsor-owned inventory. Removing the var stops the service from signing, while the old
   EOA key can still be used by anyone who possesses it.
2. Generate a fresh signer through the operator's key management process. Fund the address
   with test REACT on Lasna, and test ETH and the fixed starter-token inventory on Unichain
   Sepolia. Verify the balances and the configured factory addresses.
3. Update `SPONSOR_PRIVATE_KEY` in Heroku's config dashboard. The change releases and restarts
   the app. Check `/health` and use a fresh test wallet to verify both deployments, reserve
   top-ups, vault linking, and starter funds.
4. Retire the old signer and transfer its remaining test inventory to the new signer or the
   operator treasury. Preserve audit records and omit the secret value from logs and records.

Broadcast transactions can still settle after rotation. Retry onboarding from the state
reported by the factories. For interrupted starter funds, inspect the claim and token
receipts before retrying so a partially funded vault receives only the outstanding amount.
