const examples = [
  {
    title: 'Schedule buys or set a price limit',
    body: 'Spend a set amount each week, or buy when the pool price falls below the limit you set.',
  },
  {
    title: 'Schedule a transfer',
    body: 'Send a fixed amount to a wallet you choose every hour, day, or week.',
  },
  {
    title: 'Watch a price range',
    body: 'Record an alert when a pool price moves outside the range you set. See it in your rule’s activity.',
  },
] as const;

export function UseCasesSection() {
  return (
    <section
      id="use-cases"
      aria-labelledby="use-cases-title"
      className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20"
    >
      <div className="grid gap-x-16 gap-y-10 border-t border-white/5 pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <h2
            id="use-cases-title"
            className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_both] text-balance text-3xl font-medium leading-snug tracking-tight text-white md:text-[2.5rem]"
          >
            What you can automate
          </h2>
        </div>

        <ul className="flex flex-col divide-y divide-white/10">
          {examples.map((example, index) => (
            <li
              key={example.title}
              className="animate-on-scroll py-6 first:pt-0 last:pb-0"
              style={{ animation: `fadeInUp 0.6s ease-out ${String(index * 0.1)}s both` }}
            >
              <div>
                <h3 className="mb-2 text-lg font-medium tracking-tight text-white">
                  {example.title}
                </h3>
                <p className="text-sm font-light leading-relaxed text-neutral-400">
                  {example.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
