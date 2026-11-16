const fadeMask = 'linear-gradient(to bottom, transparent, black 0%, black 80%, transparent)';

export function BackgroundEffects() {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
      >
        <div className="grid-lines absolute inset-0 mx-auto max-w-7xl border-r border-l border-white/[0.03]" />
        {/* Ambient top radial glows */}
        <div className="absolute top-0 left-1/2 h-[550px] w-[80vw] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_rgba(59,130,246,0.18),_transparent_70%)] opacity-60 blur-3xl" />
        <div className="absolute top-[200px] left-1/3 h-[400px] w-[50vw] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_rgba(124,92,255,0.15),_transparent_65%)] opacity-50 blur-3xl" />
      </div>
    </>
  );
}
