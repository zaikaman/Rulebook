import { landingImages } from './landing-images.js';

export function BriefSection() {
  return (
    <section
      id="proof"
      aria-labelledby="shared-proof-title"
      className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20"
    >
      <div className="grid items-center gap-12 border-t border-white/10 pt-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div>
          <span className="mb-5 inline-block text-[10px] font-medium uppercase tracking-[0.2em] text-blue-300">
            Cryptographic verification
          </span>
          <h2
            id="shared-proof-title"
            className="max-w-md text-balance text-3xl font-medium leading-[1.12] tracking-tight text-white md:text-[2.5rem]"
          >
            Three linked rows.
            <br />
            <span className="text-neutral-400">One undeniable proof.</span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-neutral-300">
            Every automated run gives you three verified transactions: the origin event on Sepolia,
            the ReactVM acknowledgment on Lasna, and the settlement on Unichain.
          </p>
          <dl className="mt-9 space-y-6 border-l border-blue-500/30 pl-5">
            <div>
              <dt className="text-sm font-medium text-white">Public block explorer verification</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                Every transaction links to blockscout and etherscan with measured end-to-end
                latency.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-white">Works even if our servers are down</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                The proof view reconstructs completely from public on-chain event logs without
                requiring any backend.
              </dd>
            </div>
          </dl>
        </div>
        <img
          src={landingImages.sharedBrief.src}
          width={landingImages.sharedBrief.width}
          height={landingImages.sharedBrief.height}
          alt="Cryptographic three-chain verification proof"
          loading="lazy"
          decoding="async"
          className="mx-auto aspect-square w-full max-w-[520px] object-contain [mask-image:radial-gradient(closest-side,black_62%,transparent_100%)]"
        />
      </div>
    </section>
  );
}
