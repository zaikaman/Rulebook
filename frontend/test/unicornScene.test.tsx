import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnicornScene } from '../src/components/landing/unicorn-scene.js';

describe('UnicornScene', () => {
  const originalMatchMedia = window.matchMedia;
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  let observerCallback: IntersectionObserverCallback | undefined;
  let observerDisconnect: ReturnType<typeof vi.fn>;
  let reducedMotion = false;

  beforeEach(() => {
    reducedMotion = false;
    observerCallback = undefined;
    observerDisconnect = vi.fn();

    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    globalThis.IntersectionObserver = vi.fn((cb: IntersectionObserverCallback) => {
      observerCallback = cb;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: observerDisconnect,
        takeRecords: () => [],
        root: null,
        rootMargin: '',
        thresholds: [],
      };
    }) as unknown as typeof IntersectionObserver;

    HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    globalThis.IntersectionObserver = originalIntersectionObserver;
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.pause = originalPause;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('renders the looping 60fps hero video with WebM and MP4 sources and starts playback', () => {
    const { container } = render(<UnicornScene />);

    const video = container.querySelector('video[data-unicorn-mode="video"]');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    expect(video?.getAttribute('poster')).toBeTruthy();

    const sources = [...container.querySelectorAll('video source')].map((el) =>
      el.getAttribute('type'),
    );
    expect(sources).toEqual(['video/webm', 'video/mp4']);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('script[src*="unicorn"]')).toHaveLength(0);
  });

  it('pauses when scrolled offscreen or tab-hidden, resumes when visible, and cleans up on unmount', () => {
    const { unmount } = render(<UnicornScene />);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    act(() => {
      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);

    act(() => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);

    unmount();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(3);
    expect(observerDisconnect).toHaveBeenCalledTimes(1);
  });

  it('plays on devices with reduced-motion enabled or without WebGL2', () => {
    reducedMotion = true;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const { container } = render(<UnicornScene />);

    expect(container.querySelector('video[data-unicorn-mode="video"]')).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
});
