import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section>
      <h1>Nothing here</h1>
      <p className="muted">
        That page doesn't exist. <Link to="/">Back to the music</Link>.
      </p>
    </section>
  );
}
