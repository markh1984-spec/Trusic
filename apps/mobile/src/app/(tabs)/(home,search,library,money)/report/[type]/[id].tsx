import { useLocalSearchParams } from "expo-router";
import { ReportScreen } from "../../../../../screens/ReportScreen";

export default function Route() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  return <ReportScreen type={type} id={id} />;
}
