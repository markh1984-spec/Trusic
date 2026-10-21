import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";

function ResendButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  if (state === "sent") return <span className="small">Sent. Check your inbox (and spam folder).</span>;
  if (state !== "idle" && state !== "sending") return <span className="small text-danger">{state}</span>;
  return (
    <button
      className="button button--ghost button--small"
      disabled={state === "sending"}
      onClick={() => {
        setState("sending");
        api.resendVerification().then(
          () => setState("sent"),
          (e: unknown) => setState(e instanceof Error ? e.message : "Couldn't send it."),
        );
      }}
    >
      {state === "sending" ? "Sending…" : "Send the link again"}
    </button>
  );
}

/** A gentle reminder, shown until the account's email address is confirmed. */
export function VerifyBanner() {
  const { me } = useAuth();
  if (!me || me.user.emailVerified) return null;
  return (
    <div className="verify-banner" role="status">
      <p>
        Please confirm your email address: we've sent a link to <strong>{me.user.email}</strong>. You can listen without
        it, but you'll need it to upload music or get paid.
      </p>
      <ResendButton />
    </div>
  );
}

/** Shows `children` only once the email address is confirmed; otherwise explains why not. */
export function RequireVerifiedEmail({ children, to }: { children: ReactNode; to: string }) {
  const { me } = useAuth();
  if (me && !me.user.emailVerified) {
    return (
      <section className="card narrow">
        <h1>Confirm your email first</h1>
        <p>
          Before you {to}, please confirm your email address. We've sent a link to <strong>{me.user.email}</strong>.
          This helps us contact you about your music and your money.
        </p>
        <div className="row">
          <ResendButton />
          <Link to="/settings">Wrong address? Change it in Settings</Link>
        </div>
      </section>
    );
  }
  return <>{children}</>;
}
