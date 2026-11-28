# Income sweep demo

[Watch or download the captioned video (1:30)](rulebook-buildathon.mp4). The first half shows an unsigned draft on the hosted app. The second half opens receipts from the November 28 Testnet runs.

## Transcript

**0:00 · Rulebook.** Rulebook sets aside part of an incoming payment automatically. Follow one income sweep from a draft to a real testnet receipt.

**0:10 · Build the rule.** Choose the Income sweep recipe on Unichain Sepolia. For a payment of at least 1 USDC, send 0.20 USDC. For a smaller payment of at least 0.25 USDC, send 0.05 USDC. Below that, skip. Choose the wallet that receives the sweep. [Open the builder](https://rulebook-chi.vercel.app/workflows/new?network=testnet)

**0:31 · Review the limits.** The canvas shows all three paths. Set a 1 USDC weekly budget, then review the recipient and spending limits. The owner authorizes the Vault on Unichain, then enables watching on Reactive Lasna.

**0:47 · Follow the proof.** In the confirmed run, the first receipt is the incoming payment. Lasna observes it and requests a callback. The third receipt shows what the Vault did. All three receipts are public. [Open the 1.20 USDC run](https://rulebook-chi.vercel.app/runs/0xfde2a4ef2a2dbebae6417c14112ef7ab6626867c7da52fd50d784e71aac57309?network=testnet)

**1:04 · Verify the callback.** The explorer identifies the callback proxy and the completed transfer. The Vault sent 0.20 USDC to the recipient after a 1.20 USDC payment. [View the transfer](https://unichain-sepolia.blockscout.com/tx/0xa149f9cffbff4b1ed121e6d581b95c92dc7506b1d65403fa7d3e2d68bd64bf1a?tab=token_transfers)

**1:17 · Compare a second run.** A separate 0.60 USDC payment took the smaller branch and sent 0.05 USDC. The repository links to both runs, the deployed contracts, and the steps to try it yourself. [Open the 0.60 USDC run](https://rulebook-chi.vercel.app/runs/0xfa496fb75cc35521f8bdc9baf81a48ec3553d8a2c60202d889fea014d603f0de?network=testnet) · [View the transfer](https://unichain-sepolia.blockscout.com/tx/0xf521d0901b6c18bcc9f052f5d0f1e5dc7007b59b92bc68b19a9075d50dfdaab6?tab=token_transfers)

[Run your own income sweep](../workflows.md#run-your-first-income-sweep) · [Verify the contracts and trace the source](../submission-evidence.md#trace-a-receipt-through-the-code)
