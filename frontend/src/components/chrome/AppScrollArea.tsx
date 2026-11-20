import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';

export function AppScrollArea({ children }: { readonly children: ReactNode }) {
  const { pathname } = useLocation();
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    area.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div ref={area} className="app-scroll">
      {children}
    </div>
  );
}
