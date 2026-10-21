import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, tokenStore } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Loading } from "../components/Guards";
import { useToast } from "../toast";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="card form auth-form">
        <h1>Check your email</h1>
        <p>
          If there's a Trusic account for <strong>{email.trim()}</strong>, we've sent it a link to choose a new
          password. The link works for 1 hour.
        </p>
        <p className="muted small">Nothing there after a few minutes? Check your spam folder, or try again.</p>
        <Link to="/login">Back to log in</Link>
      </div>
    );
  }

  return (
    <form className="card form auth-form" onSubmit={submit}>
      <h1>Forgotten your password?</h1>
      <p className="muted">Enter the email address you use for Trusic and we'll send you a link to choose a new one.</p>
      {error ? <ErrorNote message={error} /> : null}
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <button className="button" disabled={busy}>
        {busy ? "Sending…" : "Send me a link"}
      </button>
      <p className="muted">
        Remembered it? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className="card auth-form">
        <h1>That link isn't complete</h1>
        <p>Please use the whole link from the email, or ask for a new one.</p>
        <Link to="/forgot-password">Ask for a new link</Link>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== repeat) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword(token, password);
      tokenStore.set(res.token);
      await refresh();
      toast("Password changed. You're logged in.");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form auth-form" onSubmit={submit}>
      <h1>Choose a new password</h1>
      <p className="muted">This signs you out on every other device.</p>
      {error ? (
        <>
          <ErrorNote message={error} />
          {/expired|used/.test(error) ? <Link to="/forgot-password">Ask for a new link</Link> : null}
        </>
      ) : null}
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <small className="muted">At least 8 characters.</small>
      </label>
      <label>
        Type it again
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}

// A link can only be used once, so make sure it's only sent once even if the page renders twice.
const verifications = new Map<string, Promise<{ email: string }>>();

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { me, refresh } = useAuth();
  const [result, setResult] = useState<{ email: string } | { error: string } | null>(null);

  useEffect(() => {
    if (!token) return setResult({ error: "That link isn't complete. Please use the whole link from the email." });
    if (!verifications.has(token)) verifications.set(token, api.verifyEmail(token));
    verifications.get(token)!.then(
      (r) => {
        setResult(r);
        void refresh();
      },
      (e: unknown) => setResult({ error: e instanceof Error ? e.message : "Couldn't confirm your email." }),
    );
  }, [token, refresh]);

  if (!result) return <Loading />;
  if ("error" in result) {
    return (
      <div className="card auth-form">
        <h1>We couldn't confirm that</h1>
        <ErrorNote message={result.error} />
        <p className="muted">
          {me ? (
            <>
              You can send a new link from the banner at the top of the page, or from{" "}
              <Link to="/settings">Settings</Link>.
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link> to send a new link.
            </>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="card auth-form">
      <h1>Email confirmed</h1>
      <p>
        Thank you. <strong>{result.email}</strong> is confirmed, so you can upload music and set up payouts.
      </p>
      <Link to={me ? "/studio" : "/login"} className="button">
        {me ? "Go to Studio" : "Log in"}
      </Link>
    </div>
  );
}
