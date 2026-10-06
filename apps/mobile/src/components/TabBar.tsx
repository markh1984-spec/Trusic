import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { View } from "react-native";
import { colors } from "../theme";
import { MiniPlayer } from "./MiniPlayer";

/** The mini player sits on top of the tab bar, on every tab. */
export function TabBar(props: BottomTabBarProps) {
  return (
    <View style={{ backgroundColor: colors.tabBar }}>
      <View style={{ backgroundColor: colors.bg, paddingTop: 4 }}>
        <MiniPlayer />
      </View>
      <BottomTabBar {...props} />
    </View>
  );
}
