import { useLocalSearchParams } from "expo-router";
import { PlaylistScreen } from "../../../../screens/PlaylistScreen";

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlaylistScreen id={id} />;
}
