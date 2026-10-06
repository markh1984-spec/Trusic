export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** Missing when the saved position is off every screen (a monitor was unplugged): the window is centred. */
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1280, height: 820 };
/** Below 860px wide the web app switches to its narrow layout, which still works down to this size. */
export const MIN_SIZE = { width: 800, height: 600 };

/**
 * Turn whatever was saved last time into a size and position that's safe to use on the screens
 * connected now.
 */
export function restoreWindowState(saved: unknown, workAreas: Rect[]): WindowState {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined);

  const width = Math.max(num(s.width) ?? DEFAULT_SIZE.width, MIN_SIZE.width);
  const height = Math.max(num(s.height) ?? DEFAULT_SIZE.height, MIN_SIZE.height);
  const state: WindowState = { width, height, maximized: s.maximized === true };

  const x = num(s.x);
  const y = num(s.y);
  if (x !== undefined && y !== undefined && isReachable({ x, y, width, height }, workAreas)) {
    state.x = x;
    state.y = y;
  }
  return state;
}

/** The title bar has to be on a screen, far enough in to grab and drag. */
function isReachable(window: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((area) => {
    const overlapX = Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x);
    const titleBarOnScreen = window.y >= area.y - 16 && window.y <= area.y + area.height - 48;
    return overlapX >= 120 && titleBarOnScreen;
  });
}
