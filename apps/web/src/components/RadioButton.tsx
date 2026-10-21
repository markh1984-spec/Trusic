import type { RadioSeed } from "@trusic/client";
import { useState } from "react";
import { usePlayer } from "../player";
import { useToast } from "../toast";
import { Icon } from "./Icon";

/** Starts an endless radio station of similar music. Visitors and non-subscribers hear previews. */
export function RadioButton({ seed, name }: { seed: RadioSeed; name: string }) {
  const { startRadio } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await startRadio(seed);
      toast(`Playing ${name} radio`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start the radio.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="button button--ghost" onClick={() => void start()} disabled={busy} title={`Start ${name} radio`}>
      <Icon name="radio" size={18} />
      Radio
    </button>
  );
}
