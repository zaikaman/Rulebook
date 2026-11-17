const symptoms = [
  {
    title: 'Bots quietly take custody of your money',
    body: 'Centralized limit-order and DCA platforms hold your private keys or route funds into shared contracts you cannot withdraw from if the service pauses.',
  },
  {
    title: 'Servers crash right when volatility peaks',
    body: 'Cloud workers, cron scripts, and off-chain indexers stall during network spikes, leaving stop-losses unexecuted and transfers delayed.',
  },
  {
    title: 'Gas fee friction drains smaller balances',
    body: 'Managing gas reserves across multiple networks just to evaluate conditions costs more in maintenance and failed tx fees than the strategy makes.',
  },
] as const;

export function ProblemSection() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-x-16 gap-y-10 border-t border-white/5 pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <span className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_both] mb-4 inline-block text-[10px] font-medium uppercase tracking-[0.2em] text-blue-300/70">
            The problem
          </span>
          <p className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.1s_both] text-balance text-2xl font-medium leading-snug tracking-tight text-white md:text-3xl">
            Personal automations shouldn&rsquo;t require running a bot or surrendering custody.{' '}
            <span className="text-neutral-400">
              Users build fragile scripts or trust centralized platforms, and it falls apart the
              moment the market moves.
            </span>
          </p>
        </div>

        <ol className="flex flex-col">
          {symptoms.map((symptom, index) => (
            <li
              key={symptom.title}
              className="animate-on-scroll flex gap-6 border-white/5 py-7 first:pt-0 not-last:border-b"
              style={{ animation: `fadeInUp 0.6s ease-out ${String(index * 0.1)}s both` }}
            >
              <span aria-hidden className="pt-1 font-mono text-xs text-neutral-400">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="mb-2 text-lg font-medium tracking-tight text-white">
                  {symptom.title}
                </h3>
                <p className="text-sm font-light leading-relaxed text-neutral-400">
                  {symptom.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
