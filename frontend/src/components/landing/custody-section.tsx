import { Link } from 'react-router';

import { appRoutes } from '@/lib/routes.js';
import { landingImages } from './landing-images.js';

export function CustodySection() {
  return (
    <section
      id="guarantees"
      aria-labelledby="vault-title"
      className="relative z-10 mx-auto max-w-6xl scroll-mt-28 px-6 py-20"
    >
      <div className="grid items-center gap-12 border-t border-white/10 pt-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div>
          <h2
            id="vault-title"
            className="max-w-md text-balance text-3xl font-medium leading-[1.12] tracking-tight text-white md:text-[2.5rem]"
          >
            Your wallet owns the vault
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-neutral-300">
            Funds you deposit go into a vault on Unichain Sepolia. Only your wallet can withdraw
            them directly.
          </p>
          <dl className="mt-6 space-y-5">
            <div>
              <dt className="text-sm font-medium text-white">Network fees</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                Add test REACT for watching and test ETH for running your workflows.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-white">Wallet transactions</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                Your wallet may show a network fee for transactions you submit directly, such as
                withdrawals.
              </dd>
            </div>
          </dl>
          <Link
            to={appRoutes.cost}
            className="mt-6 inline-block text-sm font-medium text-blue-200 underline underline-offset-4 hover:text-white"
          >
            See who pays for what
          </Link>
        </div>
        <img
          src={landingImages.proof.src}
          width={landingImages.proof.width}
          height={landingImages.proof.height}
          alt=""
          loading="lazy"
          decoding="async"
          className="mx-auto aspect-square w-full max-w-[520px] object-contain [mask-image:radial-gradient(closest-side,black_62%,transparent_100%)]"
        />
      </div>
    </section>
  );
}
