import { EMBED_HEIGHT, embedCode, embedUrl, type EmbedKind, type EmbedTheme } from "@trusic/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { qrCode, qrPath } from "../qr";
import { copyText, origin, shareLink, shareUrl, usesShareSheet, type ShareTarget } from "../share";
import { useToast } from "../toast";
import { Icon } from "./Icon";
import "../share.css";

export interface ShareAction {
  label: string;
  onSelect(): void;
}

const NOUNS = { track: "track", release: "release", artist: "artist", playlist: "playlist" } as const;

/** The Share menu's choices for `target`, and the dialog the chosen one opens. */
export function useShareActions(target: ShareTarget): { actions: ShareAction[]; dialog: ReactNode } {
  const toast = useToast();
  const [open, setOpen] = useState<"embed" | "qr" | null>(null);
  const actions: ShareAction[] = [
    { label: usesShareSheet() ? "Share link…" : "Copy link", onSelect: () => void shareLink(target, toast) },
  ];
  // Playlists can be made private at any time, so they can't go on other websites.
  if (target.kind !== "playlist") actions.push({ label: "Embed on a website…", onSelect: () => setOpen("embed") });
  actions.push({ label: "QR code…", onSelect: () => setOpen("qr") });

  const close = () => setOpen(null);
  const dialog =
    open === "embed" ? (
      <EmbedDialog target={target} onClose={close} />
    ) : open === "qr" ? (
      <QrDialog target={target} onClose={close} />
    ) : null;
  return { actions, dialog };
}

/** A "Share" button for a page, with a small menu: copy the link, embed it, or show a QR code. */
export function ShareButton({ target }: { target: ShareTarget }) {
  const { actions, dialog } = useShareActions(target);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className="button button--ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="share" size={18} /> Share
      </button>
      {open ? (
        <div className="menu__popover menu__popover--start" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {dialog}
    </div>
  );
}

/** A modal dialog. Clicks inside don't reach the track row or menu around it. */
function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      // React's development mode opens, closes and reopens it once; only a close that sticks counts.
      onClose={() => !ref.current?.open && onClose()}
      onClick={(e) => {
        e.stopPropagation();
        // A click on the dimmed backdrop lands on the dialog itself.
        if (e.target === ref.current) ref.current.close();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="dialog__body">
        <div className="dialog__head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={() => ref.current?.close()} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

const THEMES: { value: EmbedTheme; label: string }[] = [
  { value: "auto", label: "Match the visitor's device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function EmbedDialog({ target, onClose }: { target: ShareTarget; onClose(): void }) {
  const kind = target.kind as EmbedKind;
  const toast = useToast();
  const [theme, setTheme] = useState<EmbedTheme>("auto");
  const [site, setSite] = useState<string | null>(null);
  useEffect(() => void origin().then(setSite), []);
  const code = site ? embedCode(site, kind, target.key, { title: `${target.title} on Trusic`, theme }) : "";
  // The desktop app's pages can't show other websites, so it skips the preview.
  const canPreview = /^https?:$/.test(window.location.protocol);

  return (
    <Dialog title={`Put this ${NOUNS[kind]} on your website`} onClose={onClose}>
      <p className="muted small">
        Copy this code into your website, for example into a "Custom HTML" or "Embed" block. Visitors hear 30-second
        previews (they don't count as plays), always see the AI label, and can open Trusic to listen in full.
      </p>
      <fieldset className="embed-options">
        <legend className="small">Colours</legend>
        {THEMES.map((t) => (
          <label key={t.value} className="inline-check small">
            <input type="radio" name="embed-theme" checked={theme === t.value} onChange={() => setTheme(t.value)} />
            {t.label}
          </label>
        ))}
      </fieldset>
      {site && canPreview ? (
        <iframe
          key={theme}
          className="embed-preview"
          src={embedUrl(site, kind, target.key, theme)}
          height={EMBED_HEIGHT[kind]}
          title="Preview of the embedded player"
        />
      ) : null}
      <label className="form-field small">
        Code
        <textarea className="code" readOnly rows={4} value={code} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="row">
        <button
          className="button"
          disabled={!code}
          onClick={async () =>
            toast((await copyText(code)) ? "Embed code copied" : "Couldn't copy. Select the code and copy it yourself.")
          }
        >
          Copy code
        </button>
      </div>
    </Dialog>
  );
}

function QrDialog({ target, onClose }: { target: ShareTarget; onClose(): void }) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => void shareUrl(target).then(setUrl), [target]);
  const modules = url ? qrCode(url) : null;
  const qr = modules ? qrPath(modules) : null;

  /** A PNG big enough to print on a poster. */
  const download = () => {
    if (!modules) return;
    const scale = 16;
    const size = (modules.length + 8) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (const [y, row] of modules.entries()) {
      for (const [x, dark] of row.entries()) if (dark) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `trusic-${target.kind}-qr-code.png`;
    link.click();
  };

  return (
    <Dialog title="QR code" onClose={onClose}>
      <p className="muted small">
        Point a phone's camera at it to open this {NOUNS[target.kind]} on Trusic. Handy for posters, flyers and the
        merch table.
      </p>
      {qr ? (
        <svg className="qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code for ${url}`}>
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
      ) : url ? (
        <p className="note note--warn small">This link is too long for a QR code.</p>
      ) : null}
      {url ? <p className="qr__url small">{url}</p> : null}
      <div className="row">
        <button className="button" disabled={!qr} onClick={download}>
          Download picture
        </button>
        <button
          className="button button--ghost"
          disabled={!url}
          onClick={async () => toast(url && (await copyText(url)) ? "Link copied" : "Couldn't copy the link.")}
        >
          Copy link
        </button>
      </div>
    </Dialog>
  );
}
