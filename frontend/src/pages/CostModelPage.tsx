import { Coins01Icon, SecurityCheckIcon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { PageHeading } from '@/components/chrome/PageHeading.js';

export function CostModelPage() {
  return (
    <div className="space-y-8">
      <PageHeading
        title="Cost & Custody Model"
        description="Who pays for what, why custody stays with you, and how the platform sustains sponsored gas."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* User Side */}
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <HugeiconsIcon icon={Wallet01Icon} size={20} />
            </div>
            <div>
              <h3 className="font-heading font-semibold text-white text-lg">What You Pay</h3>
              <span className="font-mono text-xs text-emerald-400">Zero Native Fee Tokens</span>
            </div>
          </div>

          <p className="text-sm text-neutral-300 leading-relaxed">
            You only deposit the trading principal you want your rules to use (e.g. USDC). You never
            need to acquire or manage fee tokens on Lasna or destination chains.
          </p>

          <ul className="space-y-2 text-xs font-mono text-neutral-400 border-t border-white/5 pt-4">
            <li className="flex items-center justify-between">
              <span>Account Deployment:</span>
              <span className="text-emerald-400">Free ($0.00)</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Rule Evaluation Gas:</span>
              <span className="text-emerald-400">Sponsored ($0.00)</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Destination Execution:</span>
              <span className="text-emerald-400">Sponsored ($0.00)</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Withdrawal:</span>
              <span className="text-white">Direct via your wallet</span>
            </li>
          </ul>
        </div>

        {/* Operator Side */}
        <div className="rounded-3xl border border-white/5 bg-white/[0.02] p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
              <HugeiconsIcon icon={Coins01Icon} size={20} />
            </div>
            <div>
              <h3 className="font-heading font-semibold text-white text-lg">
                What The Operator Funds
              </h3>
              <span className="font-mono text-xs text-blue-400">Operational Sponsorship</span>
            </div>
          </div>

          <p className="text-sm text-neutral-300 leading-relaxed">
            The platform maintains subscription balances on the Reactive Network and destination
            relayers to fund continuous contract evaluation and transaction relaying.
          </p>

          <ul className="space-y-2 text-xs font-mono text-neutral-400 border-t border-white/5 pt-4">
            <li className="flex items-center justify-between">
              <span>Lasna Reactive Gas:</span>
              <span className="text-blue-400">Paid by Operator</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Destination Relayer:</span>
              <span className="text-blue-400">Paid by Operator</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Price Indexing & Sync:</span>
              <span className="text-blue-400">Paid by Operator</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Custody Access:</span>
              <span className="text-red-400 font-bold">Zero Operator Access</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Custody Guarantee Card */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-8 space-y-4">
        <div className="flex items-center gap-3 text-blue-400">
          <HugeiconsIcon icon={SecurityCheckIcon} size={22} />
          <h3 className="font-heading font-semibold text-white text-lg">
            Why Custody Remains 100% Yours
          </h3>
        </div>

        <p className="text-sm text-neutral-300 leading-relaxed">
          Your personal Vault contract on Unichain Sepolia is deployed with your wallet as its
          immutable owner. The operator contracts can only request valid actions (such as a Uniswap
          swap) if authorized by a cryptographically signed rule matching your exact parameters.
          Under no circumstances can the operator, the relayer, or the indexer initiate a transfer
          of principal to any other address. You can call <code>withdraw()</code> directly on your
          Vault at any time.
        </p>
      </div>
    </div>
  );
}
