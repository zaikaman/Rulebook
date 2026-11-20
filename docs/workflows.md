# Rulebook Workflows

A workflow starts when the Vault receives USDC, on a schedule, or when the configured USDC/WETH pool price crosses a target. Payment and price workflows can add up to three levels of conditions. The chosen path runs up to three steps in order. A step can send USDC, buy WETH, or record an on-chain alert. A path with no steps skips the run.

Use **Workflows → New workflow** to start with an example or an empty workflow. Choose a node to edit it. Phones use the same editor with an outline. Review the plain-English summary, approve the Vault authorization on Unichain Sepolia, then enable the workflow on Reactive Lasna. Keep watching credit and execution credit funded in **Account & Vault**. A USDC deposit to the Vault can trigger a payment workflow. The balance left after a workflow runs can be withdrawn by the owner.

Only the owner can create, change, or stop a workflow. Pause or cancel blocks spending on Unichain first and then stops new decisions on Lasna. Earlier callbacks no longer have an approved authorization after a pause, edit, or resume. A branch settles as one transaction. If an action fails, transfers and swaps from earlier steps roll back.

Activity shows the original event, the Lasna decision, and the destination outcome if confirmed. A request by itself does not confirm settlement. An alert is recorded in the destination transaction.

Publish a workflow version from its detail page. Each listing refers to the exact published program, even if the author later updates their own workflow. The author can unpublish any listed version. Copying opens a draft with the recipient and spending cap cleared. The copy runs on the new user's own account. Popularity counts distinct non-author wallets that activate an attributed copy with matching authorizations on both chains.

## Deploy and verify

Build with Foundry and regenerate shared ABIs with `npm run generate`. Set `DEPLOYER_PRIVATE_KEY`, `LASNA_RPC_URL`, and `UNICHAIN_RPC_URL` in the ignored contracts environment and keep keys out of shell history. Broadcast `DeployWorkflows.s.sol:DeployWorkflows` on Lasna and Unichain Sepolia using the configured RPC aliases. The Lasna broadcast creates the directory and Agent factory. The Unichain broadcast creates the Vault factory. Record the confirmed addresses, blocks, transaction hashes, and runtime code hashes.

Apply backend migrations before starting the new workflow indexer. Set `WORKFLOW_DIRECTORY_ADDRESS`, `WORKFLOW_VAULT_FACTORY_ADDRESS`, `WORKFLOW_START_BLOCK_LASNA`, and `WORKFLOW_START_BLOCK_UNICHAIN` from the confirmed receipts. Set `INDEXER_ENABLED=true`. Set the matching `VITE_WORKFLOW_DIRECTORY_ADDRESS` and `VITE_WORKFLOW_VAULT_FACTORY_ADDRESS` on the frontend and point its API URL to the backend.

Run `npm run verify` and the Playwright tests. For live acceptance, start from the savings template and use 1.20, 0.60, and 0.10 USDC origin payments to check the two funded paths and the skip. Check a native scheduled tick and a real price crossing. Publish from the first wallet and activate an edited copy from a second. Verify counts and receipts before recording the buildathon demo.
