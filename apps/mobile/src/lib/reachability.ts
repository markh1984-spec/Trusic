/**
 * Whether the Trusic server answered the app's last request. The phone can have signal and still not
 * reach the server (a server that's down, or Wi-Fi that needs a sign-in page), and offline mode applies
 * then too. Every API call reports here (see api.ts).
 */
type Listener = (reachable: boolean) => void;

let reachable = true;
const listeners = new Set<Listener>();

export const serverReachability = {
  get(): boolean {
    return reachable;
  },
  report(ok: boolean) {
    if (ok === reachable) return;
    reachable = ok;
    for (const listener of listeners) listener(ok);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
