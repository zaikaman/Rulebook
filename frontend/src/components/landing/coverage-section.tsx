import { CustodyBarsGlyph, GasEfficiencyGlyph, LatencyTraceGlyph } from './measure-glyphs.js';
import { SectionHeading } from './section-heading.js';

const measures = [
  {
    name: '100% User Custody',
    Glyph: CustodyBarsGlyph,
    scale: 'Vault owned by user wallet',
    caption:
      'Funds never leave your destination Vault contract. You can withdraw your full principal balance at any moment with zero operator permission.',
  },
  {
    name: 'Zero Native Gas Required',
    Glyph: GasEfficiencyGlyph,
    scale: '100% Operator Sponsored',
    caption:
      'You need no ETH or fee tokens to deploy rules or trigger execution. The operator maintains subscription credit on Reactive Network and destination chains.',
  },
  {
    name: 'Deterministic Reactive Latency',
    Glyph: LatencyTraceGlyph,
    scale: 'Measured block-to-block delay',
    caption:
      'Autonomous ReactVM listeners evaluate state directly from event logs. Verified execution latency is tracked and transparently recorded in every proof.',
  },
] as const;

export function CoverageSection() {
  return (
    <section id="metrics" className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20">
      <SectionHeading
        eyebrow="What it measures"
        title="Three numbers, and none of them are guesses"
        lede="Everything is deterministic and verifiable on-chain. No server holds your keys or estimates your gas."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {measures.map((measure, index) => (
          <div
            key={measure.name}
            className="animate-on-scroll flex flex-col gap-3 rounded-3xl border border-white/5 bg-white/[0.02] p-6"
            style={{ animation: `fadeInUp 0.6s ease-out ${String(index * 0.1)}s both` }}
          >
            <div className="mb-2 h-28 rounded-2xl border border-white/5 bg-black/40 p-4">
              <measure.Glyph />
            </div>
            <h3 className="text-base font-medium tracking-tight text-white">{measure.name}</h3>
            <p className="text-sm leading-relaxed text-neutral-400">{measure.caption}</p>
            <span className="mt-auto pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-400">
              {measure.scale}
            </span>
          </div>
        ))}
      </div>

      <p className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.3s_both] mt-8 max-w-2xl text-xs font-light leading-relaxed text-neutral-400">
        Figures reflect live on-chain contract state across Lasna and destination networks. Nothing on this page is a simulated estimate.
      </p>
    </section>
  );
}
