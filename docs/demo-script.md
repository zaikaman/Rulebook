# Demo script

Target runtime **2:55**. Use testnet wallets and have the receipts open before recording.

| Time      | Show and say                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:18 | Open Rulebook. “A trading bot needs a process and a signing key. Here I own the Agent that evaluates rules and the Vault that holds my funds.”                                                                                                    |
| 0:18–0:48 | Build Friday DCA with the schedule, amount and token controls. Show the sentence and calldata, then review and sign on Lasna.                                                                                                                     |
| 0:48–1:16 | Open a confirmed execution. Follow the origin, Lasna and Unichain links and read the measured latency. Keep the chain source and outcome visible.                                                                                                 |
| 1:16–1:45 | Show the seeded pool reserves, cross the limit with a small swap, and show the resulting destination receipt. Read the thin-pair disclosure below.                                                                                                |
| 1:45–2:13 | Select a team listing, review the clone with a second wallet, and open the copy in its new owner's rules.                                                                                                                                         |
| 2:13–2:35 | Show the leader and follower destination receipts and the follower's per-run cap. If the grouped proof has no callback records, show the verified receipts and state what the testnet returned. Say if the deployed build has mirroring disabled. |
| 2:35–2:55 | Show a confirmed execution from an unattended run and open the three balances. Read the sponsorship disclosure below.                                                                                                                             |

**Thin pair.** “We seeded this thin demo pool so a small swap could move the price on
camera. Our earlier Unichain Sepolia WETH/USDC measurement put the public pool near
$33,700 of liquidity and a five-percent move near $400 of USDC.”

**Sponsored credit.** “Rulebook sponsors deployment and execution credit. This vault’s
principal belongs to my wallet. If the sponsors stop topping up, automation can pause.
Anyone can add credit, and I can still withdraw my principal.”

Use the actual start and destination receipts in the capture. Label fixture views
on screen if you use them to illustrate UI alongside the live receipts.

## Prepare the thin-pool beat

Use a dedicated Uniswap V2-compatible demo router and factory on Unichain Sepolia for
the WETH/USDC liquidity. Set `DEMO_ROUTER_ADDRESS` to that router. Both scripts identify
the pool through its factory and reject the default public WETH/USDC pool.

```powershell
node --import tsx scripts/seed-thin-pair.ts
$env:DEMO_SELL_TOKEN = 'WETH'
$env:DEMO_SWAP_AMOUNT = '0.001'
node --import tsx scripts/move-price.ts
```

These commands inspect the target and quote without broadcasting. For the seed, set
`DEMO_WALLET_PRIVATE_KEY` through an ignored local environment file or secret store and
run with `DEMO_BROADCAST=1`. The seed defaults to 30 test USDC and 0.02 test WETH.
Use the same flag to execute the quoted swap. Give the demo rule the seeded pair as its
trigger. Confirm the destination receipt independently. A standard Vault uses the
configured public execution router even when a dedicated pool supplies the trigger.

The checked-in walkthrough uses local browser fixtures for the UI and recorded
testnet receipts for settlement. The recorded testnet trigger was a `Sync` on the
configured pool. [Watch the walkthrough](./demo.mp4)
