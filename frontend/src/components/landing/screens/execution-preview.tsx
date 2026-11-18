const executionSteps = [
  { chain: 'Sepolia', event: 'Price crossed $2,500' },
  { chain: 'Lasna', event: 'Callback dispatched' },
  { chain: 'Unichain', event: 'Vault swap settled' },
] as const;

export function ExecutionPreview() {
  return (
    <div className="flex h-full flex-col justify-center gap-[7cqw] bg-[#090b10] px-[9cqw]">
      <div className="flex flex-col gap-[2cqw]">
        <span className="font-mono text-[4.2cqw] uppercase tracking-widest text-emerald-300">
          Verified
        </span>
        <span className="text-[9cqw] font-semibold leading-tight text-white">Execution proof</span>
      </div>
      <ol className="flex flex-col gap-[4cqw]">
        {executionSteps.map(({ chain, event }) => (
          <li
            key={chain}
            className="rounded-[4cqw] border border-blue-300/15 bg-blue-400/10 p-[4cqw]"
          >
            <span className="block text-[5.7cqw] font-medium text-blue-200">{chain}</span>
            <span className="mt-[1cqw] block text-[4.5cqw] text-neutral-300">{event}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
