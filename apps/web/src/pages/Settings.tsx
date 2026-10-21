import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { api, tokenStore } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, RequireAuth } from "../components/Guards";
import { money } from "../format";
import { useAsync } from "../hooks";
import { YourDevices } from "../offline/YourDevices";
import { useToast } from "../toast";

export function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}

/** Runs a form action, keeping track of whether it's busy and what went wrong. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Section({
  title,
  intro,
  children,
  danger,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={`card settings-section${danger ? " danger-zone" : ""}`}>
      <h2>{title}</h2>
      {intro ? <p className="muted">{intro}</p> : null}
      {children}
    </section>
  );
}

function Settings() {
  return (
    <div className="narrow">
      <h1>Settings</h1>
      <Profile />
      <Email />
      <Password />
      <SignOutEverywhere />
      <YourDevices />
      <YourData />
      <DeleteAccount />
    </div>
  );
}

function Profile() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me!.user.displayName);
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.updateProfile({ displayName: name.trim() });
      await refresh();
      toast("Name saved");
    });
  };

  return (
    <Section title="Your name" intro="Shown on your playlists and to band members you share splits with.">
      <form className="form" onSubmit={submit}>
        {error ? <ErrorNote message={error} /> : null}
        <label>
          Display name
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="button button--ghost" disabled={busy || name.trim() === me!.user.displayName}>
          Save name
        </button>
      </form>
    </Section>
  );
}

function Email() {
  const { me, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const { busy, error, run } = useAction();
  const { user, pendingEmail } = me!;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.changeEmail(email.trim(), password);
      await refresh();
      setEmail("");
      setPassword("");
      setSent(true);
    });
  };

  return (
    <Section title="Email address">
      <p>
        <strong>{user.email}</strong>{" "}
        {user.emailVerified ? (
          <span className="pill pill--ok">Confirmed</span>
        ) : (
          <span className="pill pill--warn">Not confirmed yet</span>
        )}
      </p>
      {!user.emailVerified ? (
        <p className="small">
          You need to confirm it before you can upload music or set up payouts.{" "}
          {resent ? (
            "We've sent a new link."
          ) : (
            <button
              className="link-button"
              onClick={() => void run(async () => (await api.resendVerification(), setResent(true)))}
            >
              Send the link again
            </button>
          )}
        </p>
      ) : null}
      {pendingEmail ? (
        <p className="note note--warn small">
          {sent ? "Nearly done: we" : "We"}'ve sent a link to <strong>{pendingEmail}</strong>. Your email changes to it
          once you click that link. Until then, keep using {user.email}.
        </p>
      ) : null}
      <form className="form" onSubmit={submit}>
        {error ? <ErrorNote message={error} /> : null}
        <label>
          New email address
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Your password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small className="muted">So nobody else can change it if you leave yourself logged in somewhere.</small>
        </label>
        <button className="button button--ghost" disabled={busy}>
          Change email
        </button>
      </form>
    </Section>
  );
}

function Password() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (next !== repeat) throw new Error("The two new passwords don't match.");
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      toast("Password changed. Your other devices have been signed out.");
    });
  };

  return (
    <Section title="Password" intro="Changing your password signs you out on every other device.">
      <form className="form" onSubmit={submit}>
        {error ? <ErrorNote message={error} /> : null}
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <Link to="/forgot-password" className="small">
          Forgotten your current password?
        </Link>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <small className="muted">At least 8 characters.</small>
        </label>
        <label>
          New password again
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        <button className="button button--ghost" disabled={busy}>
          Change password
        </button>
      </form>
    </Section>
  );
}

function SignOutEverywhere() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  return (
    <Section
      title="Signed-in devices"
      intro="Lost a phone, or logged in on someone else's computer? This signs you out on every device, including this one."
    >
      {error ? <ErrorNote message={error} /> : null}
      <button
        className="button button--ghost"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api.logoutEverywhere();
            await logout();
            navigate("/login");
          })
        }
      >
        Sign out everywhere
      </button>
    </Section>
  );
}

function YourData() {
  const { busy, error, run } = useAction();

  const download = () =>
    run(async () => {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trusic-data-${data.exportedAt.slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

  return (
    <Section
      title="Download your data"
      intro="A copy of everything Trusic holds about you, as a JSON file you can open in a text editor or import elsewhere."
    >
      <p className="small">
        It includes your profile, artist profiles, details of the tracks you've uploaded (not the audio itself, which
        you already have), every play, your likes, playlists and follows, your monthly statements, earnings and balance
        history, any strikes and appeals, and reports you've sent or that were made about your music.
      </p>
      {error ? <ErrorNote message={error} /> : null}
      <button className="button button--ghost" disabled={busy} onClick={() => void download()}>
        {busy ? "Preparing…" : "Download my data"}
      </button>
    </Section>
  );
}

function DeleteAccount() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, run } = useAction();
  const balance = useAsync(() => (open ? api.balance() : Promise.resolve(null)), [open]);
  const owed = balance.data ? balance.data.balance : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.deleteAccount(password);
      tokenStore.set(null);
      await refresh();
      toast("Your account has been deleted.");
      navigate("/", { replace: true });
    });
  };

  return (
    <Section title="Delete your account" danger>
      <p>Deleting your account can't be undone. Here's exactly what happens:</p>
      <ul className="rules-list small">
        <li>
          <strong>Gone straight away:</strong> your name, email address and password, your likes, playlists and follows,
          and everywhere you're signed in.
        </li>
        <li>
          <strong>Your uploads come down for good,</strong> including tracks you share with band members, and their
          audio and artwork are deleted. Your artist profiles are hidden and renamed "Deleted artist".
        </li>
        <li>
          <strong>Your share of other people's tracks</strong> (band splits) goes to whoever uploaded each track.
        </li>
        <li>
          <strong>Kept, without your name or email:</strong> your plays and payments, and the monthly payout records
          built from them. Other people's statements and Trusic's accounts depend on these, so removing them would
          change what other artists were paid.
        </li>
        <li>
          <strong>Money you haven't been paid yet isn't paid out</strong> once your account is deleted. If you're owed
          money, wait until it's been paid before deleting.
        </li>
        <li>
          <strong>Your subscription stops</strong> straight away.
        </li>
        <li>
          <strong>You can sign up again</strong> with the same email address, as a brand-new account.
        </li>
      </ul>
      {!open ? (
        <button className="button button--danger" onClick={() => setOpen(true)}>
          I want to delete my account
        </button>
      ) : (
        <form className="form" onSubmit={submit}>
          {owed > 0 && balance.data ? (
            <p className="note note--warn small">
              You have <strong>{money(owed, balance.data.currency)}</strong> in earnings that haven't been paid to you
              yet. If you delete your account now, you won't receive it.
            </p>
          ) : null}
          {me!.user.plan === "premium" ? (
            <p className="note note--warn small">Your Premium subscription will be cancelled straight away.</p>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
          <label>
            Your password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Type DELETE to confirm
            <input required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </label>
          <div className="row">
            <button className="button button--danger" disabled={busy || confirm !== "DELETE"}>
              {busy ? "Deleting…" : "Delete my account for good"}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
