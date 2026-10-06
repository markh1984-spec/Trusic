import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth";
import { ErrorNote } from "../components/Guards";

function useNext() {
  const [params] = useSearchParams();
  const next = params.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form auth-form" onSubmit={submit}>
      <h1>Log in</h1>
      {error ? <ErrorNote message={error} /> : null}
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="button" disabled={busy}>
        {busy ? "Logging in…" : "Log in"}
      </button>
      <p className="muted">
        New here?{" "}
        <Link to={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
      </p>
    </form>
  );
}

export function RegisterPage() {
  const { me, register } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, displayName);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form auth-form" onSubmit={submit}>
      <h1>Join Trusic</h1>
      <p className="muted">Listen free, go Premium to pay the artists you love, or upload your own music.</p>
      {error ? <ErrorNote message={error} /> : null}
      <label>
        Your name
        <input required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
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
      <button className="button" disabled={busy}>
        {busy ? "Creating account…" : "Create account"}
      </button>
      <p className="muted">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}
