import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { TrackActionsProvider } from "../components/TrackActions";
import { AuthProvider } from "../state/auth";
import { LibraryProvider } from "../state/library";
import { PlayerProvider } from "../state/player";
import { ToastProvider } from "../state/toast";
import { colors } from "../theme";

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <ToastProvider>
        <AuthProvider>
          <LibraryProvider>
            <PlayerProvider>
              <TrackActionsProvider>
                <StatusBar style="light" />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="now-playing"
                    options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", title: "Now playing" }}
                  />
                </Stack>
              </TrackActionsProvider>
            </PlayerProvider>
          </LibraryProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
