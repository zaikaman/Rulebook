import { useEffect, useRef } from 'react';
import heroBackdropMp4 from '@/assets/landing/hero-backdrop.mp4';
import heroBackdropPoster from '@/assets/landing/hero-backdrop-poster.webp';
import heroBackdropWebm from '@/assets/landing/hero-backdrop.webm';

export function UnicornScene() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let inView = true;

    const syncPlayback = () => {
      if (inView && !document.hidden) {
        void video.play().catch(() => {
          // Autoplay may be blocked by browser policy; poster remains visible.
        });
      } else {
        video.pause();
      }
    };

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (!entry) return;
              inView = entry.isIntersecting;
              syncPlayback();
            },
            { rootMargin: '120px 0px' },
          )
        : undefined;
    observer?.observe(video);

    document.addEventListener('visibilitychange', syncPlayback);
    syncPlayback();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', syncPlayback);
      video.pause();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      data-unicorn-mode="video"
      className="h-full w-full object-cover object-top"
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      poster={heroBackdropPoster}
    >
      <source src={heroBackdropWebm} type="video/webm" />
      <source src={heroBackdropMp4} type="video/mp4" />
    </video>
  );
}
