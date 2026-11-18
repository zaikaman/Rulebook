import type { CSSProperties } from 'react';
import { landingImages } from './landing-images.js';
import { CoverPhoto } from './screens/cover-photo.js';
import { ExecutionPreview } from './screens/execution-preview.js';
import { ScreenSurface } from './screens/screen-surface.js';
import { screens } from './screens/screen-geometry.js';

const edgeFade: CSSProperties = {
  maskImage:
    'linear-gradient(to right, transparent, black 16%, black 84%, transparent), linear-gradient(to bottom, transparent, black 8%, black 90%, transparent)',
  maskComposite: 'intersect',
  WebkitMaskImage:
    'linear-gradient(to right, transparent, black 16%, black 84%, transparent), linear-gradient(to bottom, transparent, black 8%, black 90%, transparent)',
  WebkitMaskComposite: 'source-in',
};

export function PhoneShowcase() {
  return (
    <div aria-hidden className="relative aspect-[4/3] w-full">
      <div className="absolute inset-0" style={edgeFade}>
        <CoverPhoto
          image={landingImages.executionPhone}
          frameClassName=""
          motionClassName=""
          imageClassName=""
        >
          <ScreenSurface geometry={screens.executionPhone}>
            <ExecutionPreview />
          </ScreenSurface>
        </CoverPhoto>
      </div>
    </div>
  );
}
