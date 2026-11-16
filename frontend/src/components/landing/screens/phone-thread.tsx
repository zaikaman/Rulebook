const bubbles = [
  { outbound: true, lines: [82, 64, 40] },
  { outbound: false, lines: [70, 48] },
  { outbound: true, lines: [88, 72, 55, 36] },
  { outbound: false, lines: [42] },
] as const;

export function PhoneThread() {
  return (
    <div className="absolute inset-0 flex flex-col gap-[2.5cqh] p-[7cqw] pt-[9cqh] bg-[#050608]">
      <div className="flex items-center gap-[2cqw]">
        <span className="h-[1.2cqw] w-[1.2cqw] rounded-full bg-emerald-400" />
        <span className="h-[1.1cqh] w-[46%] rounded-full bg-white/25" />
      </div>
      {bubbles.map((bubble, index) => (
        <div
          key={index}
          className={`flex w-[82%] flex-col gap-[1.1cqh] rounded-[3cqw] p-[4cqw] ${
            bubble.outbound ? 'self-start bg-white/[0.07]' : 'self-end bg-blue-500/25'
          }`}
        >
          {bubble.lines.map((line, lineIndex) => (
            <span
              key={lineIndex}
              className={`h-[0.9cqh] rounded-full ${bubble.outbound ? 'bg-white/25' : 'bg-blue-200/60'}`}
              style={{ width: `${String(line)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
