/**
 * Preload for the Server… window only. The main Trusic window has no preload at all.
 *
 * It drives the form from here, in its own isolated world, so the page itself runs no script and nothing
 * is exposed to it. The main process also checks that these messages come from this window.
 */
import { ipcRenderer } from "electron";
import type { SaveResult, ServerInfo } from "./server-dialog";

window.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector<HTMLFormElement>("#form")!;
  const input = document.querySelector<HTMLInputElement>("#url")!;
  const note = document.querySelector<HTMLElement>("#note")!;
  const save = document.querySelector<HTMLButtonElement>("#save")!;
  const useDefault = document.querySelector<HTMLButtonElement>("#default")!;
  const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
  const environment = document.querySelector<HTMLElement>("#environment")!;

  let force = false;
  const setNote = (text: string, isError = false) => {
    note.textContent = text;
    note.classList.toggle("note--error", isError);
  };
  const resetForce = () => {
    force = false;
    save.textContent = "Save and reload";
  };

  void ipcRenderer.invoke("server:get").then((info: ServerInfo) => {
    input.value = info.url;
    input.select();
    useDefault.dataset.url = info.defaultUrl;
    if (info.environmentValue) {
      environment.hidden = false;
      environment.textContent = `TRUSIC_SERVER_URL is set to ${info.environmentValue}, so Trusic goes back to that address each time it starts.`;
    }
  });

  input.addEventListener("input", () => {
    resetForce();
    setNote("");
  });

  useDefault.addEventListener("click", () => {
    input.value = useDefault.dataset.url ?? "";
    resetForce();
    setNote("");
    input.focus();
  });

  cancel.addEventListener("click", () => ipcRenderer.send("server:close"));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") ipcRenderer.send("server:close");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    setNote(force ? "Saving…" : "Checking…");
    void ipcRenderer
      .invoke("server:save", input.value, force)
      .then((result: SaveResult) => {
        if (result.ok) return;
        setNote(result.error, true);
        if (result.canForce) {
          force = true;
          save.textContent = "Save anyway";
        }
      })
      .catch(() => setNote("Something went wrong. Please try again.", true))
      .finally(() => {
        save.disabled = false;
      });
  });
});
