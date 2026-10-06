import { useLocalSearchParams } from "expo-router";
import { TrackScreen } from "../../../../screens/TrackScreen";

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TrackScreen id={id} />;
}
