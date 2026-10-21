import { Link } from "react-router";

/** How to send a copyright notice, and what happens next. */
export function CopyrightPage() {
  return (
    <article className="legal">
      <h1>Copyright on Trusic</h1>
      <p>
        Artists upload their own music to Trusic. If you think something here uses your music, lyrics or artwork without
        permission, tell us and a person will look at it quickly.
      </p>

      <h2>How to send a copyright notice</h2>
      <ol>
        <li>Find the track, release, artist or playlist on Trusic.</li>
        <li>
          Open its <strong>⋯</strong> menu, choose <strong>Report…</strong>, then{" "}
          <strong>Copyright infringement</strong>. You can also{" "}
          <Link to="/report">paste its link into the report form</Link>. If the problem is only the cover artwork or an
          artist photo, you can report that on its own.
        </li>
        <li>
          Fill in the notice. To act on it we need:
          <ul>
            <li>your full name, and your organisation if you're acting for one;</li>
            <li>a postal address and an email address (a phone number is optional);</li>
            <li>whether you own the copyright or are authorised to act for the owner;</li>
            <li>the original work: its title, who made it, and where it's published;</li>
            <li>what on Trusic copies it, and which part (the form fills in where it is);</li>
            <li>
              a statement that you believe in good faith the use isn't authorised by the owner, their agent or the law;
            </li>
            <li>a statement that the notice is accurate and you're the owner or authorised to act for them;</li>
            <li>your name, typed as a signature.</li>
          </ul>
        </li>
      </ol>
      <p>
        We show the uploader your name or organisation and the work you've described. We don't show them your address,
        phone number or email address.
      </p>

      <h2>What happens next</h2>
      <ul>
        <li>We email you a reference straight away.</li>
        <li>A person at Trusic reviews your notice. If something's missing or unclear, we'll email you a question.</li>
        <li>
          If we agree, we take the content down. It's hidden everywhere on Trusic, it can't be played, and it doesn't
          earn money in months that haven't been paid out yet. We email the uploader to tell them why.
        </li>
        <li>If we don't agree, we email you to explain why.</li>
      </ul>

      <h2>If your music was taken down</h2>
      <ul>
        <li>
          You can send a <strong>counter-notice</strong> from the link in our email, or from{" "}
          <Link to="/studio">Studio</Link>, if you think it was taken down by mistake: for example, you wrote it, you
          have a licence, or it was mistaken for something else.
        </li>
        <li>We pass your counter-notice, with your name and email address, to the person who complained.</li>
        <li>
          They can tell us within 10 working days if they've started legal action. If they don't, we may put your music
          back.
        </li>
        <li>If we put it back, the copyright strike from that takedown is withdrawn.</li>
      </ul>

      <h2>Repeat infringers</h2>
      <ul>
        <li>Each copyright takedown we uphold is a copyright strike against the uploader's account.</li>
        <li>
          Three copyright strikes suspend the account: all its music comes down and it can't upload. A Trusic admin can
          lift a suspension, and the strikes stay on record.
        </li>
        <li>
          Copyright strikes are kept separate from strikes for false AI declarations, which work the same way. Artists
          see both kinds in Studio.
        </li>
      </ul>

      <h2>Other problems</h2>
      <p>
        Use the same <strong>Report…</strong> menu for offensive or illegal content, for profiles pretending to be
        someone else, and for AI labels that look wrong. If someone is in immediate danger, call 999.
      </p>

      <p className="muted small">
        This page explains how Trusic handles copyright today. It isn't legal advice, and Trusic's full terms are still
        being written (see <Link to="/legal/terms">Terms</Link>).
      </p>
    </article>
  );
}

/** Clearly a placeholder: lists what a lawyer has to write before launch. Nothing here pretends to be final. */
export function TermsPage() {
  return (
    <article className="legal">
      <h1>Terms</h1>
      <div className="placeholder-banner">
        <strong>These terms haven't been written yet.</strong> This page is a placeholder and nothing on it is a legal
        agreement. A lawyer must write Trusic's terms before it opens to the public.
      </div>

      <h2>What a lawyer needs to write</h2>
      <ol>
        <li>
          <strong>Terms of service for listeners.</strong> Who can use Trusic (including any minimum age), what Premium
          includes, the price including VAT, renewals and cancellation, refunds and the 14-day cooling-off right
          (including the new subscription rules due in January 2027), previews, suspending and closing accounts, limits
          of liability, governing law, and how to complain.
        </li>
        <li>
          <strong>The artist agreement.</strong> The licence artists give Trusic for their recordings, artwork and
          words; their promise that they own or have cleared the rights (samples, covers, session players); the AI
          declaration and what happens if it's false (strikes, corrected scores, clawbacks, suspension); how payouts
          work (80% to artists, user-centric, human-weighted, band splits, the payout minimum, finalised months);
          songwriter details and PRS for Music; and tax.
        </li>
        <li>
          <strong>Copyright and repeat-infringer policy.</strong> The formal version of{" "}
          <Link to="/legal/copyright">how copyright notices work</Link>: what a valid notice and counter-notice must
          contain, the timescales, how repeat infringers are treated, and what happens after a notice that's knowingly
          false.
        </li>
        <li>
          <strong>Content rules and complaints.</strong> What mustn't be uploaded (illegal content, hate, harassment,
          impersonation and so on), how reports are handled, and how people can complain about our decisions, as the
          Online Safety Act requires.
        </li>
        <li>
          <strong>Privacy notice (UK GDPR).</strong> Who is responsible for people's data, what's collected and why, who
          it's shared with (for example Stripe, the email service and the hosting company), how long it's kept
          (including the anonymous payment records kept after an account is deleted), and people's rights, including
          complaining to the Information Commissioner's Office.
        </li>
        <li>
          <strong>Cookies and browser storage.</strong> What Trusic keeps in the browser, such as the sign-in token.
        </li>
        <li>
          <strong>Company details.</strong> Trusic's legal name, company number, registered address and a contact email
          address, which UK law requires a business website to show.
        </li>
      </ol>

      <h2>Until then</h2>
      <ul>
        <li>
          How Trusic pays artists: <Link to="/transparency">Transparency</Link>
        </li>
        <li>
          Copyright problems: <Link to="/legal/copyright">Copyright on Trusic</Link>
        </li>
        <li>
          Your account and your data: <Link to="/settings">Settings</Link>
        </li>
      </ul>
    </article>
  );
}
