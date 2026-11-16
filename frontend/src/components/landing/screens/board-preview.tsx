const lanes = [
  {
    title: 'TRIGGERS',
    cards: [
      { top: 4, height: 18, color: 'bg-blue-400/30' },
      { top: 28, height: 24, color: 'bg-white/15' },
      { top: 58, height: 16, color: 'bg-white/15' },
    ],
  },
  {
    title: 'CONDITIONS',
    cards: [
      { top: 4, height: 20, color: 'bg-amber-400/30' },
      { top: 30, height: 16, color: 'bg-white/15' },
      { top: 52, height: 24, color: 'bg-white/15' },
    ],
  },
  {
    title: 'ACTIONS',
    cards: [
      { top: 8, height: 22, color: 'bg-purple-400/30' },
      { top: 36, height: 18, color: 'bg-white/15' },
      { top: 60, height: 20, color: 'bg-white/15' },
    ],
  },
  {
    title: 'PROOFS',
    cards: [
      { top: 4, height: 16, color: 'bg-emerald-400/40' },
      { top: 26, height: 26, color: 'bg-emerald-400/40' },
      { top: 58, height: 18, color: 'bg-emerald-400/40' },
    ],
  },
] as const;

export function BoardPreview() {
  return (
    <div className="absolute inset-0 flex flex-col gap-[3cqh] p-[4cqw] bg-[#070709]">
      {/* Top app bar */}
      <div className="flex items-center gap-[1.5cqw]">
        <span className="h-[1.6cqh] w-[14cqw] rounded-full bg-white/30" />
        <span className="h-[1.4cqh] w-[8cqw] rounded-full bg-emerald-500/50" />
        <span className="ml-auto h-[3cqh] w-[16cqw] rounded-full bg-blue-500/80" />
      </div>

      {/* 4 Rule Lanes */}
      <div className="grid flex-1 grid-cols-4 gap-[2cqw]">
        {lanes.map((lane, laneIndex) => (
          <div key={laneIndex} className="relative rounded-[1cqw] bg-white/[0.03]">
            <span className="absolute inset-x-[15%] top-[1.5cqh] h-[1.2cqh] rounded-full bg-white/20" />
            {lane.cards.map((card) => (
              <span
                key={card.top}
                className={`absolute inset-x-[8%] rounded-[0.8cqw] ring-1 ring-white/10 ${card.color}`}
                style={{ top: `${String(card.top + 8)}%`, height: `${String(card.height)}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
