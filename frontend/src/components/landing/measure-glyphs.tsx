export function CustodyBarsGlyph() {
  return (
    <div aria-hidden className="flex h-full flex-col justify-center gap-2.5">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-white">User Custody</span>
        <span className="text-emerald-400 font-bold">100%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
        <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_10px_#22c55e]" />
      </div>
      <div className="flex items-center justify-between text-[10px] text-neutral-400">
        <span>Operator Access: 0%</span>
        <span>Instant Withdrawal</span>
      </div>
    </div>
  );
}

export function GasEfficiencyGlyph() {
  return (
    <div aria-hidden className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-white">Gas Paid by User</span>
        <span className="text-blue-400 font-bold">0.00 ETH</span>
      </div>
      <div className="grid grid-cols-6 gap-1 h-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className="rounded bg-gradient-to-t from-blue-600/30 to-blue-400/80 shadow-[0_0_6px_rgba(59,130,246,0.3)]"
          />
        ))}
      </div>
      <span className="text-[10px] text-neutral-400 font-mono">Sponsored execution active</span>
    </div>
  );
}

export function LatencyTraceGlyph() {
  return (
    <div aria-hidden className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-white">Reactive Delay</span>
        <span className="text-amber-400 font-bold">&lt; 900 ms</span>
      </div>
      <div className="relative flex items-center h-4">
        <div className="absolute inset-x-0 h-0.5 bg-white/10" />
        <div className="absolute left-[15%] h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_8px_#3b82f6]" />
        <div className="absolute left-[50%] h-2.5 w-2.5 rounded-full bg-indigo-400 shadow-[0_0_8px_#7c5cff]" />
        <div className="absolute left-[85%] h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#22c55e]" />
      </div>
      <div className="flex justify-between text-[9px] font-mono text-neutral-400">
        <span>Event</span>
        <span>ReactVM</span>
        <span>Settled</span>
      </div>
    </div>
  );
}
