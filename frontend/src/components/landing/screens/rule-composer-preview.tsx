const ruleFields = [
  { label: 'Trigger', value: 'ETH below $2,500', color: 'text-blue-300' },
  { label: 'Action', value: 'Swap 250 USDC', color: 'text-violet-300' },
  { label: 'Destination', value: 'Personal Vault', color: 'text-emerald-300' },
] as const;

export function RuleComposerPreview() {
  return (
    <div className="flex h-full flex-col bg-[#0a0b11] px-[5cqw] text-[2.25cqw]">
      <div className="flex items-center justify-between border-b border-white/10 py-[3cqw]">
        <span className="font-semibold text-white">Rulebook</span>
        <span className="text-neutral-400">Create rule</span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-[2.5cqw]">
        <span className="font-mono text-[1.65cqw] uppercase tracking-widest text-blue-300">
          Limit buy
        </span>
        <p className="max-w-[85%] text-[4.3cqw] font-medium leading-tight tracking-tight text-white">
          When ETH drops below <span className="text-blue-300">$2,500</span>, swap{' '}
          <span className="text-violet-300">250 USDC</span> for ETH.
        </p>
        <dl className="grid grid-cols-3 gap-[1.5cqw]">
          {ruleFields.map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-[1cqw] border border-white/10 bg-white/5 p-[1.5cqw]"
            >
              <dt className="text-[1.6cqw] text-neutral-400">{label}</dt>
              <dd className={`mt-[0.4cqw] font-medium ${color}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <span className="border-t border-white/10 py-[2cqw] text-[1.7cqw] text-neutral-400">
        Execution gas sponsored
      </span>
    </div>
  );
}
