import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'frontend/src/assets/landing');
const SCRATCH_DIR =
  'C:/Users/zaika/.gemini/antigravity/brain/43f5abc0-6c8b-4a06-90fb-0a70aa447ca4/scratch';

const PROJECT_ID = 'bKN5upvoulAmWvInmHza';
const RUNTIME_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.5.3/dist/unicornStudio.umd.js';
const WIDTH = 1600;
const HEIGHT = 900;
const TOTAL_FRAMES = 400; // 400 * 0.25 uTime/frame = 100.0 = exact 1 full beam cycle at 60fps (6.67s)
const START_BEAM_TIME = 6.0; // fract(6.0 * 0.01 + 0.19) = 0.25 -> 90deg (dark top seam)
const POSTER_FRAME = 155; // sweeping bottom-left arc

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed with status ${result.status}`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const framesDir = mkdtempSync(join(tmpdir(), 'unicorn-hero-frames-'));

  console.log('Capturing', TOTAL_FRAMES, 'frames at', `${WIDTH}x${HEIGHT} (1x 60fps speed)...`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });

    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden"><div id="box" style="position:relative;width:${WIDTH}px;height:${HEIGHT}px"></div></body></html>`,
    );
    await page.addScriptTag({ url: RUNTIME_URL });

    const setupInfo = await page.evaluate(
      async ({ projectId, startBeamTime }) => {
        const el = document.getElementById('box');
        const scene = await window.UnicornStudio.addScene({
          element: el,
          projectId,
          lazyLoad: false,
          production: true,
          scale: 1,
          dpi: 1.5,
          fps: 60,
          interactivity: { mouse: { disabled: true, disableMobile: true } },
        });

        await new Promise((r) => setTimeout(r, 2000));
        scene.paused = true;

        const planes = scene.curtain?.planes ?? [];
        const before = planes.map((p) => p.uniforms?.time?.value ?? null);
        scene.renderFrame();
        const after = planes.map((p) => p.uniforms?.time?.value ?? null);

        // Identify the slow-advancing beam plane (+0.25/frame) vs projection plane (+0.5/frame)
        const deltas = planes.map((_, i) =>
          before[i] !== null && after[i] !== null ? after[i] - before[i] : 0,
        );
        const beamPlaneIdx = deltas.findIndex((d) => d > 0 && d < 0.35);

        for (let i = 0; i < planes.length; i += 1) {
          const p = planes[i];
          if (p.uniforms?.time) {
            p.uniforms.time.value = i === beamPlaneIdx ? startBeamTime : 0;
          }
        }

        window.__unicornHeroCapture = { scene, beamPlaneIdx };
        const c = el.querySelector('canvas');
        return {
          canvasW: c?.width,
          canvasH: c?.height,
          beamPlaneIdx,
          deltas,
        };
      },
      { projectId: PROJECT_ID, startBeamTime: START_BEAM_TIME },
    );

    console.log('Scene setup:', JSON.stringify(setupInfo));

    for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
      await page.evaluate(() => {
        window.__unicornHeroCapture.scene.renderFrame();
      });

      const framePath = join(framesDir, `frame_${String(frame).padStart(4, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });
      if ((frame + 1) % 80 === 0) {
        console.log(`Captured ${frame + 1}/${TOTAL_FRAMES} frames`);
      }
    }
  } finally {
    await browser.close();
  }

  const inputPattern = join(framesDir, 'frame_%04d.png');
  const mp4Path = join(OUT_DIR, 'hero-backdrop.mp4');
  const webmPath = join(OUT_DIR, 'hero-backdrop.webm');
  const posterPath = join(OUT_DIR, 'hero-backdrop-poster.webp');

  console.log('Encoding MP4...');
  runFfmpeg([
    '-y',
    '-framerate',
    '60',
    '-i',
    inputPattern,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-movflags',
    '+faststart',
    '-an',
    mp4Path,
  ]);

  console.log('Encoding WebM...');
  runFfmpeg([
    '-y',
    '-framerate',
    '60',
    '-i',
    inputPattern,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '29',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-an',
    webmPath,
  ]);

  const posterSrc = join(framesDir, `frame_${String(POSTER_FRAME).padStart(4, '0')}.png`);
  console.log('Encoding poster WebP...');
  runFfmpeg(['-y', '-i', posterSrc, '-c:v', 'libwebp', '-quality', '90', posterPath]);

  runFfmpeg([
    '-y',
    '-ss',
    '2.58',
    '-i',
    mp4Path,
    '-frames:v',
    '1',
    '-update',
    '1',
    join(SCRATCH_DIR, 'verify_mp4.png'),
  ]);
  runFfmpeg([
    '-y',
    '-ss',
    '2.58',
    '-i',
    webmPath,
    '-frames:v',
    '1',
    '-update',
    '1',
    join(SCRATCH_DIR, 'verify_webm.png'),
  ]);

  console.log('Output sizes (bytes):', {
    mp4: statSync(mp4Path).size,
    webm: statSync(webmPath).size,
    poster: statSync(posterPath).size,
  });

  rmSync(framesDir, { recursive: true, force: true });
}

await main();
