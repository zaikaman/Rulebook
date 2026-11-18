# Top up execution reserves

In Rulebook, open **Account & Vault** and use **Fund your account** to add monitoring
or execution fees from your wallet. The app selects the network and credits the correct
account. Faucet links are under **Need more test tokens?**.

## Command-line verification and funding

Read **reserves** and **debt** on the contract that bills the target. The Lasna system
contract credits the Agent in test REACT. The Unichain Sepolia callback proxy credits the
Vault in test ETH. Anyone can top up either account using their own funded testnet wallet.

```powershell
$system = '0x8888888888888888888888888888888888888888'
$proxy = '0x775c9B990ADe401060B78D0e98684eEf8d2466C1'
cast call $system 'reserves(address)(uint256)' $agent --rpc-url $env:LASNA_RPC_URL
cast call $system 'debt(address)(uint256)' $agent --rpc-url $env:LASNA_RPC_URL
cast call $proxy 'reserves(address)(uint256)' $vault --rpc-url $env:UNICHAIN_RPC_URL
cast call $proxy 'debt(address)(uint256)' $vault --rpc-url $env:UNICHAIN_RPC_URL
```

Verify the wallet, chain ID, target and intended amount before submitting. Set
`$agentTopUpWei` and `$vaultTopUpWei` independently. Each amount should cover outstanding
debt plus the desired credit. Use the encrypted Foundry keystore account named in `$account`.

```powershell
cast send $system 'depositTo(address)' $agent --value $agentTopUpWei --account $account --rpc-url $env:LASNA_RPC_URL
cast send $proxy 'depositTo(address)' $vault --value $vaultTopUpWei --account $account --rpc-url $env:UNICHAIN_RPC_URL
```

Confirm both receipts. Read reserves and debt again, then look for the next matching event.
Principal in the Vault stays separate from execution credit.

**Always pass the beneficiary to `depositTo(address)`.** A plain transfer to a billing
contract can credit the sender. A plain transfer directly to an Agent or Vault can strand
the funds without settling debt or increasing reserves.
