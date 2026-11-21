# Execution costs

Base fees measured on **2026-11-16**. Per-event charges and annual totals are estimates at
those rates. The testnets can change their gas prices and surcharge parameters.

| Network                         | Observed base fee |
| ------------------------------- | ----------------: |
| Reactive Lasna, block 8,466,858 |          100 gwei |
| Unichain Sepolia                |       0.0015 gwei |
| Base Sepolia, reference only    |        0.005 gwei |

Reactive calculates charges as `max(tx.gasprice, block.basefee) × coefficient × (gasUsed + extraGas)`.
The coefficient is the on-chain value divided by 1,000. A wake-up can incur a charge even
when no rule fires or evaluation reverts. The destination callback has its own fee parameters.

| Operation              | Estimated cost |
| ---------------------- | -------------: |
| Add a rule             |    0.022 REACT |
| Cron tick, no fire     |    0.013 REACT |
| Cron tick, fires       |    0.022 REACT |
| Price event, no fire   |    0.014 REACT |
| Price event, fires     |    0.023 REACT |
| Unichain callback swap |  0.0000006 ETH |

| Setup                             | Approximate REACT/year |
| --------------------------------- | ---------------------: |
| Daily DCA, Cron10000 (~3 hours)   |                     44 |
| Weekly DCA, Cron10000             |                     42 |
| Daily DCA, Cron1000 (~17 minutes) |                    410 |
| Daily DCA, Cron100 (~2 minutes)   |                  4,100 |
| Price rule, 10 events/day         |                     51 |
| Price rule, 1,000 events/day      |                  5,100 |

Weekly DCA costs about as much as daily at the same subscription interval because
both Agents wake for every tick. Price-rule cost scales with the number of matching events.
The price-rule estimates use the non-firing rate and exclude destination ETH and one-time setup.
The cron figures are planning estimates derived from observed base fees and Reactive network parameters.

## Verify current parameters

Set `LASNA_RPC_URL` and `UNICHAIN_RPC_URL` to the networks' RPC URLs. Use the system
contract and callback proxy from the deployment records.

```powershell
$system = '0x8888888888888888888888888888888888888888'
$proxy = '0x775c9B990ADe401060B78D0e98684eEf8d2466C1'
cast block latest --field baseFeePerGas --rpc-url $env:LASNA_RPC_URL
cast block latest --field baseFeePerGas --rpc-url $env:UNICHAIN_RPC_URL
foreach ($method in '_extraGas()(uint256)', '_gasPriceCoeffPer1000()(uint256)', '_maxChargeGas()(uint256)') {
  cast call $system $method --rpc-url $env:LASNA_RPC_URL
  cast call $proxy $method --rpc-url $env:UNICHAIN_RPC_URL
}
```

On **2026-11-18**, Lasna returned 100,000 extra gas and a coefficient of 1,000.
Unichain Sepolia returned 80,000 extra gas and a coefficient of 1,100.
Use current readings when estimating reserves. [Reactive economy documentation](https://dev.reactive.network/economy) · [Measured receipts](./measurements.md)
