import type { CSSProperties } from 'react';
import { landingImages } from './landing-images.js';
import { CoverPhoto } from './screens/cover-photo.js';
import { RuleComposerPreview } from './screens/rule-composer-preview.js';
import { ScreenSurface } from './screens/screen-surface.js';
import { screens } from './screens/screen-geometry.js';

const edgeFade: CSSProperties = {
  maskImage:
    'linear-gradient(to right, transparent, black 10%, black 92%, transparent), linear-gradient(to bottom, transparent, black 9%, black 72%, transparent)',
  maskComposite: 'intersect',
  WebkitMaskImage:
    'linear-gradient(to right, transparent, black 10%, black 92%, transparent), linear-gradient(to bottom, transparent, black 9%, black 72%, transparent)',
  WebkitMaskComposite: 'source-in',
};

export function HeroShowcase() {
  return (
    <div
      aria-hidden
      className="animate-on-scroll [animation:fadeInUp_0.9s_ease-out_0.5s_both] relative mx-auto aspect-[16/10] w-full max-w-6xl"
    >
      <div className="absolute inset-0" style={edgeFade}>
        <CoverPhoto
          image={landingImages.heroLaptop}
          loading="eager"
          frameClassName=""
          motionClassName=""
          imageClassName=""
        >
          <ScreenSurface geometry={screens.heroLaptop}>
            <RuleComposerPreview />
          </ScreenSurface>
        </CoverPhoto>
      </div>
    </div>
  );
}
