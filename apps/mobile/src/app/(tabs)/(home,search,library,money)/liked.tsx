import { Stack } from "expo-router";
import { LikedScreen } from "../../../screens/PlaylistScreen";

export default function Route() {
  return (
    <>
      <Stack.Screen options={{ title: "Liked songs" }} />
      <LikedScreen />
    </>
  );
}
