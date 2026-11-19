import heroLaptop from '@/assets/landing/hero-laptop.webp';
import emailPhone from '@/assets/landing/email-phone.webp';
import tileImport from '@/assets/landing/tile-import.webp';
import tileIntent from '@/assets/landing/tile-intent.webp';
import tileOptimize from '@/assets/landing/tile-optimize.webp';
import tileRepair from '@/assets/landing/tile-repair.webp';
import closingHall from '@/assets/landing/closing-hall.webp';
import sharedBrief from '@/assets/landing/shared-brief.webp';

import type { LandingImage } from './screens/cover-photo.js';

export const landingImages = {
  heroLaptop: { src: heroLaptop, width: 1586, height: 992 },
  executionPhone: { src: emailPhone, width: 1448, height: 1086 },
  assemble: { src: tileImport, width: 960, height: 960 },
  condition: { src: tileIntent, width: 960, height: 960 },
  execute: { src: tileOptimize, width: 960, height: 960 },
  custody: { src: tileRepair, width: 960, height: 960 },
  vaultInterior: { src: closingHall, width: 1817, height: 866 },
  proof: { src: sharedBrief, width: 960, height: 960 },
} as const satisfies Record<string, LandingImage>;
