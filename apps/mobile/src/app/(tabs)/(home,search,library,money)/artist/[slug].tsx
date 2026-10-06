import { useLocalSearchParams } from "expo-router";
import { ArtistScreen } from "../../../../screens/ArtistScreen";

export default function Route() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <ArtistScreen slug={slug} />;
}
