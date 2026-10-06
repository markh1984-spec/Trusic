import { useRef, useState } from "react";
import { Icon } from "./Icon";

/** A button that opens a file chooser for an image and hands the file to `onPick`. */
export function ImagePicker({ label, onPick }: { label: string; onPick(file: File): Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="image-picker">
      <button type="button" className="button button--ghost" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="image" size={18} /> {busy ? "Uploading…" : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            await onPick(file);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </span>
  );
}
