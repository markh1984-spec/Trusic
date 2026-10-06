import { Stack } from "expo-router";
import { colors } from "../theme";

/** The stack inside each tab: the tab's own screen first, then anything opened from it. */
export function TabStack({ root, title }: { root: string; title: string }) {
  return (
    <Stack
      screenOptions={{
        title: "",
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "800" },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name={root} options={{ title }} />
    </Stack>
  );
}
