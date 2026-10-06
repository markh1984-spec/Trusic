import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";
import { Icon, type IconName } from "../../components/Icon";
import { TabBar } from "../../components/TabBar";
import { colors } from "../../theme";

const tabIcon =
  (name: IconName) =>
  ({ color }: { color: ColorValue }) => <Icon name={name} size={24} color={color} />;

/**
 * Five tabs, each with its own stack of screens. Tracks, releases, artists and
 * playlists open inside whichever tab you're in (see the (home,search,library,money) folder).
 */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="(home)" options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="(search)" options={{ title: "Search", tabBarIcon: tabIcon("search") }} />
      <Tabs.Screen name="(library)" options={{ title: "Library", tabBarIcon: tabIcon("library") }} />
      <Tabs.Screen name="(money)" options={{ title: "Your money", tabBarIcon: tabIcon("money") }} />
      <Tabs.Screen name="(account)" options={{ title: "Account", tabBarIcon: tabIcon("person") }} />
    </Tabs>
  );
}
