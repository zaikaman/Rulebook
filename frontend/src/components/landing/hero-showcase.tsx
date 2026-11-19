import type { CSSProperties } from 'react';
import { landingImages } from './landing-images.js';

const edgeFade: CSSProperties = {
  maskImage:
    'linear-gradient(to right, transparent, black 10%, black 92%, transparent), linear-gradient(to bottom, transparent, black 9%, black 72%, transparent)',
  maskComposite: 'intersect',
  WebkitMaskImage:
    'linear-gradient(to right, transparent, black 10%, black 92%, transparent), linear-gradient(to bottom, transparent, black 9%, black 72%, transparent)',
  WebkitMaskComposite: 'source-in',
};

export function HeroShowcase() {
  const { src, width, height } = landingImages.heroLaptop;

  return (
    <img
      src={src}
      width={width}
      height={height}
      alt=""
      decoding="async"
      className="animate-on-scroll [animation:fadeInUp_0.9s_ease-out_0.5s_both] mx-auto block h-auto w-full max-w-6xl"
      style={edgeFade}
    />
  );
}
