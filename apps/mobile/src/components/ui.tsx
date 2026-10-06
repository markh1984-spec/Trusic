import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, radius, space } from "../theme";
import { Icon, type IconName } from "./Icon";

/** A scrolling screen with the app's padding and optional pull to refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  padded = true,
}: {
  children: ReactNode;
  onRefresh?(): void;
  refreshing?: boolean;
  padded?: boolean;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[padded && styles.padded, styles.content]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.title, style]} role="heading" aria-level={1}>
      {children}
    </Text>
  );
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.heading, style]} role="heading" aria-level={2}>
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Muted({
  children,
  style,
  small,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  small?: boolean;
}) {
  return <Text style={[styles.muted, small && styles.small, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  icon,
  style,
}: {
  title: string;
  onPress(): void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const ghost = variant === "ghost";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        ghost ? styles.buttonGhost : styles.buttonPrimary,
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.8 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={ghost ? colors.text : colors.primaryInk} /> : null}
      <Text style={[styles.buttonText, { color: ghost ? colors.text : colors.primaryInk }]}>{title}</Text>
    </Pressable>
  );
}

/** A round icon button. */
export function IconButton({
  icon,
  label,
  onPress,
  size = 22,
  color = colors.text,
  disabled = false,
  active = false,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  size?: number;
  color?: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }]}
    >
      <Icon name={icon} size={size} color={active ? colors.primary : color} />
    </Pressable>
  );
}

/** The big green play button. */
export function PlayButton({
  playing,
  onPress,
  label,
  size = 56,
}: {
  playing: boolean;
  onPress(): void;
  label: string;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playing ? "Pause" : label}
      style={({ pressed }) => [
        styles.playButton,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && { transform: [{ scale: 0.96 }] },
      ]}
    >
      <Icon name={playing ? "pause" : "play"} size={size * 0.46} color={colors.primaryInk} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {children}
    </ScrollView>
  );
}

export const Loading = () => (
  <View style={styles.loading} accessibilityLabel="Loading">
    <ActivityIndicator color={colors.muted} />
  </View>
);

export const ErrorNote = ({ message }: { message: string }) => (
  <View style={styles.error} role="alert">
    <Text style={styles.errorText}>{message}</Text>
  </View>
);

/** A whole screen that failed to load. */
export function ErrorScreen({ message }: { message: string }) {
  return (
    <Screen>
      <ErrorNote message={message} />
    </Screen>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "ok" }) {
  const border = tone === "warn" ? colors.assisted : tone === "ok" ? colors.human : colors.border;
  return (
    <View style={[styles.note, { borderLeftColor: border }]}>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/** Shown on screens that need an account. */
export function SignInPrompt({ message }: { message: string }) {
  const router = useRouter();
  return (
    <Card style={{ gap: space.md }}>
      <Heading style={{ marginBottom: 0 }}>Log in to Trusic</Heading>
      <Muted>{message}</Muted>
      <Button title="Log in or sign up" onPress={() => router.navigate("/account")} />
    </Card>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: space.xxl },
  padded: { padding: space.lg },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginBottom: space.sm },
  heading: { color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: space.md },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: "transparent" },
  buttonText: { fontSize: 15, fontWeight: "700" },
  iconButton: { padding: 6, alignItems: "center", justifyContent: "center" },
  playButton: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  chips: { gap: space.sm, paddingVertical: space.xs },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: colors.bg },
  loading: { paddingVertical: space.xxl, alignItems: "center" },
  error: {
    backgroundColor: "rgba(255,107,107,0.12)",
    borderColor: "rgba(255,107,107,0.4)",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginVertical: space.sm,
  },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  note: {
    backgroundColor: colors.raised,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    padding: space.md,
    marginVertical: space.sm,
  },
  noteText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
});
