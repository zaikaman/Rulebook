import {
  Book02Icon,
  Coins01Icon,
  SecurityCheckIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { landingImages } from './landing-images.js';
import { SectionHeading } from './section-heading.js';

const steps = [
  {
    icon: Wallet01Icon,
    image: landingImages.assemble,
    title: 'Set up your account',
    body: 'Connect your wallet and follow the prompts to create and link your automation account and vault.',
  },
  {
    icon: Book02Icon,
    image: landingImages.condition,
    title: 'Build your workflow',
    body: 'Choose a trigger, add conditions, and decide what should happen on each path.',
  },
  {
    icon: SecurityCheckIcon,
    image: landingImages.execute,
    title: 'Review and sign',
    body: 'Read the workflow in plain English. Approve it on your vault network, then enable it on Reactive Network.',
  },
  {
    icon: Coins01Icon,
    image: landingImages.custody,
    title: 'Check your runs',
    body: 'See which path ran and follow its transaction receipts. You can pause or edit a workflow from your account.',
  },
] as const;

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20">
      <SectionHeading
        title="How Rulebook works"
        lede="Your automation account watches for the trigger you choose. Your vault carries out a trade or transfer if its checks pass."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className="animate-on-scroll flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] sm:flex-row-reverse"
            style={{ animation: `fadeInUp 0.6s ease-out ${String(index * 0.08)}s both` }}
          >
            <img
              src={step.image.src}
              width={step.image.width}
              height={step.image.height}
              alt=""
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover opacity-90 [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)] sm:aspect-square sm:h-auto sm:w-[44%] sm:shrink-0 sm:self-stretch sm:[mask-image:linear-gradient(to_left,black_50%,transparent_100%)]"
            />
            <div className="relative -mt-12 flex flex-col justify-center p-6 sm:mt-0 sm:p-7 sm:pr-0">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
                  <HugeiconsIcon icon={step.icon} size={16} aria-hidden="true" />
                </span>
              </div>
              <h3 className="mb-2 text-xl font-medium tracking-tight text-white">{step.title}</h3>
              <p className="max-w-md text-sm leading-relaxed text-neutral-300">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
