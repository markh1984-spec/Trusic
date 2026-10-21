import { Link, useLocation } from "react-router";
import { useDesktopOffline } from "./offline";

/** In the desktop app, when the server can't be reached: say so, and point to what still plays. */
export function OfflineBanner() {
  const offline = useDesktopOffline();
  const { pathname } = useLocation();
  if (!offline || offline.online) return null;
  const count = Object.keys(offline.state.tracks).length;
  return (
    <div className="offline-banner" role="status">
      <strong>You're offline.</strong>{" "}
      {count > 0 ? "Your downloaded music still plays." : "Music you download plays without a connection."}
      {pathname !== "/downloads" ? (
        <>
          {" "}
          <Link to="/downloads">Go to your downloads</Link>
        </>
      ) : null}
    </div>
  );
}
