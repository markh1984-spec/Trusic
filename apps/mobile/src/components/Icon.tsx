import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "../theme";

/** The web app's icons (apps/web/src/components/Icon.tsx), drawn with react-native-svg. */
const PATHS = {
  play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  next: "M6 6.5v11a.8.8 0 0 0 1.2.7l8.3-5.5a.8.8 0 0 0 0-1.4L7.2 5.8A.8.8 0 0 0 6 6.5zM16.5 6H19v12h-2.5z",
  previous: "M18 6.5v11a.8.8 0 0 1-1.2.7l-8.3-5.5a.8.8 0 0 1 0-1.4l8.3-5.5A.8.8 0 0 1 18 6.5zM5 6h2.5v12H5z",
  home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  search:
    "M10.5 4a6.5 6.5 0 1 0 4 11.6l4.2 4.2 1.4-1.4-4.2-4.2A6.5 6.5 0 0 0 10.5 4zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z",
  money: "M3 6h18v12H3zm2 2v8h14V8zm7 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  person: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.4 0 8 2 8 4.5V20H4v-1.5C4 16 7.6 14 12 14z",
  heartFilled: "M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.8c0 5.8-7.5 10.4-7.5 10.4z",
  more: "M5 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm7 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm7 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z",
} as const;

/** Line icons, drawn with a stroke rather than filled. */
const STROKES = {
  heart: "M12 20s-7-4.4-7-9.9A4 4 0 0 1 12 7.5a4 4 0 0 1 7 2.6C19 15.6 12 20 12 20z",
  shuffle: "M16 4h4v4M4 20 20 4M20 16v4h-4M15 15l5 5M4 4l5 5",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  queue: "M4 6h12M4 12h12M4 18h7M15 15.5v5l4.5-2.5z",
  plus: "M12 5v14M5 12h14",
  library: "M5 4v16M10 4v16M14.5 4.5l5 15",
  close: "M6 6l12 12M18 6 6 18",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  back: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
} as const;

export type IconName = keyof typeof PATHS | keyof typeof STROKES;

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: ColorValue }) {
  const stroke = name in STROKES;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {stroke ? (
        <Path
          d={STROKES[name as keyof typeof STROKES]}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <Path d={PATHS[name as keyof typeof PATHS]} fill={color} fillRule="evenodd" />
      )}
    </Svg>
  );
}
