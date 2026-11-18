import { useEffect, useRef } from 'react';

interface UnicornSceneInstance {
  destroy(): void;
}

interface UnicornRuntime {
  addScene(options: {
    element: HTMLDivElement;
    projectId: string;
    lazyLoad: boolean;
  }): Promise<UnicornSceneInstance>;
}

declare global {
  interface Window {
    UnicornStudio?: UnicornRuntime;
  }
}

const runtimeUrl =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js';
let runtimeLoad: Promise<UnicornRuntime | undefined> | undefined;

function loadRuntime() {
  runtimeLoad ??= new Promise<UnicornRuntime | undefined>((resolve) => {
    const script = document.createElement('script');
    script.src = runtimeUrl;
    script.async = true;
    script.onload = () => resolve(window.UnicornStudio);
    script.onerror = () => {
      script.remove();
      runtimeLoad = undefined;
      resolve(undefined);
    };
    document.head.append(script);
  });
  return runtimeLoad;
}

export function UnicornScene({ projectId }: { readonly projectId: string }) {
  const sceneContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sceneContainer.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let disposed = false;
    let scene: UnicornSceneInstance | undefined;
    void (async () => {
      const runtime = await loadRuntime();
      if (!runtime || disposed) return;

      const instance = await runtime.addScene({ element, projectId, lazyLoad: true });
      if (disposed) instance.destroy();
      else scene = instance;
    })().catch(() => {
      // The ambient background covers unsupported WebGL and unavailable embeds.
    });

    return () => {
      disposed = true;
      scene?.destroy();
    };
  }, [projectId]);

  return <div ref={sceneContainer} className="absolute inset-0" />;
}
