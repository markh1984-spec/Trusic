import { useLocalSearchParams } from "expo-router";
import { ReleaseScreen } from "../../../../screens/ReleaseScreen";

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReleaseScreen id={id} />;
}
