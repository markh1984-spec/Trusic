import type { AiLabel } from "@trusic/core";
import { Image, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { mediaUrl } from "../lib/api";
import { artworkTints, colors } from "../theme";

/** Cover art, or a tinted placeholder with the title's first letter. */
export function Artwork({
  url,
  title,
  label,
  size = 48,
  round = false,
}: {
  url: string | null;
  title: string;
  label?: AiLabel;
  /** A number of points, or "100%" to fill the parent's width (square). */
  size?: number | DimensionValue;
  round?: boolean;
}) {
  const uri = mediaUrl(url);
  const box = {
    width: size,
    aspectRatio: 1,
    borderRadius: round ? 9999 : typeof size === "number" ? Math.max(4, size * 0.08) : 8,
  } as const;
  if (uri) return <Image source={{ uri }} style={[styles.image, box]} accessibilityIgnoresInvertColors />;
  const fontSize = typeof size === "number" ? Math.max(12, size * 0.4) : 48;
  return (
    <View style={[styles.placeholder, box, { backgroundColor: artworkTints[label ?? "none"] }]} aria-hidden>
      <Text style={[styles.letter, { fontSize }]}>{title.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** A playlist cover: a 2×2 mosaic of its tracks' artwork, or one image, or a placeholder. */
export function PlaylistCover({
  urls,
  title,
  size = 48,
}: {
  urls: string[];
  title: string;
  size?: number | DimensionValue;
}) {
  if (urls.length < 4) return <Artwork url={urls[0] ?? null} title={title} size={size} />;
  return (
    <View
      style={[styles.mosaic, { width: size, aspectRatio: 1, borderRadius: typeof size === "number" ? 6 : 8 }]}
      aria-hidden
    >
      {urls.slice(0, 4).map((u) => (
        <Image key={u} source={{ uri: mediaUrl(u) ?? undefined }} style={styles.tile} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.card },
  placeholder: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  letter: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },
  mosaic: { flexDirection: "row", flexWrap: "wrap", overflow: "hidden", backgroundColor: colors.card },
  tile: { width: "50%", height: "50%" },
});
