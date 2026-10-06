import { TabStack } from "../../../components/TabStack";

/** Deep links (e.g. to a track) still have this tab's own screen underneath. */
export const unstable_settings = { anchor: "money" };

export default function Layout() {
  return <TabStack root="money" title="Your money" />;
}
