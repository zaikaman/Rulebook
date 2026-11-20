import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { Link } from 'react-router';
import { appRoutes } from '@/lib/routes.js';
import { landingImages } from './landing-images.js';

export function ClosingCta() {
  return (
    <section className="relative z-10 overflow-hidden px-6 py-28 text-center">
      <img
        src={landingImages.vaultInterior.src}
        width={landingImages.vaultInterior.width}
        height={landingImages.vaultInterior.height}
        alt=""
        loading="lazy"
        decoding="async"
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30 [mask-image:linear-gradient(to_bottom,transparent,black_40%,black_60%,transparent)]"
      />
      <div className="relative mx-auto max-w-3xl">
        <h2 className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_both] mb-5 text-4xl font-medium leading-tight tracking-tight text-white md:text-5xl">
          Try Rulebook on testnet
        </h2>
        <p className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.1s_both] mx-auto mb-10 max-w-xl text-base font-light leading-relaxed text-neutral-400">
          Get test tokens, set up your account, and create your first automation.
        </p>
        <Link
          to={appRoutes.newWorkflow}
          className="animate-on-scroll [animation:fadeInUp_0.6s_ease-out_0.2s_both] group inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-medium text-black transition-all hover:bg-neutral-200"
        >
          <span>Build a workflow</span>
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={16}
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </section>
  );
}
