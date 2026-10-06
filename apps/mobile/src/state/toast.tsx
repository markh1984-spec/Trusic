import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";

/** Clear of the tab bar and mini player. */
const BOTTOM_OFFSET = 140;

const ToastContext = createContext<(message: string) => void>(() => undefined);

/** Brief confirmations like "Added to Road trip". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const insets = useSafeAreaInsets();

  const show = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? (
        <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + BOTTOM_OFFSET }]}>
          <Text style={styles.toast} accessibilityLiveRegion="polite" role="status">
            {message}
          </Text>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  toast: {
    backgroundColor: colors.text,
    color: colors.bg,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
});
