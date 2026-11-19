export interface ScreenGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly rotate?: number;
}

export function screenStyle(geometry: ScreenGeometry) {
  return {
    left: `${String(geometry.left)}%`,
    top: `${String(geometry.top)}%`,
    width: `${String(geometry.width)}%`,
    height: `${String(geometry.height)}%`,
    borderRadius: `${String(geometry.radius)}cqw`,
    transform: geometry.rotate === undefined ? undefined : `rotate(${String(geometry.rotate)}deg)`,
  };
}

export const screens = {
  executionPhone: { left: 35.57, top: 6.63, width: 28.87, height: 83.52, radius: 3.1 },
} as const satisfies Record<string, ScreenGeometry>;
