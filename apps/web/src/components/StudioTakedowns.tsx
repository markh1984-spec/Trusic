import { REPORT_REASON_NAMES, REPORT_STATUS_NAMES } from "@trusic/client";
import { Link } from "react-router";
import { api } from "../api";
import { useAsync } from "../hooks";
import { STATUS_PILL } from "../pages/Takedown";

/** Studio's list of takedowns of the artist's content, and their copyright strikes. Hidden when there are none. */
export function StudioTakedowns() {
  const { data } = useAsync(() => api.myTakedowns(), []);
  if (!data || (data.takedowns.length === 0 && data.copyrightStrikes.length === 0)) return null;
  const active = data.copyrightStrikes.filter((s) => !s.withdrawn).length;

  return (
    <section className="card">
      <h2>Takedowns</h2>
      <p className="small">
        Copyright strikes:{" "}
        <strong>
          {active} of {data.strikesToSuspend}
        </strong>
        . At {data.strikesToSuspend}, your account is suspended. A strike is withdrawn if the content is put back after
        a counter-notice. These are separate from strikes for false AI declarations.
      </p>
      <ul className="plain-list">
        {data.takedowns.map((d) => (
          <li key={d.id}>
            <span>
              <Link to={`/takedown/${d.id}`}>{d.targetTitle}</Link>{" "}
              <span className="muted small">{REPORT_REASON_NAMES[d.reason]}</span>
            </span>
            <span className={`pill ${STATUS_PILL[d.status] ?? ""}`}>{REPORT_STATUS_NAMES[d.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
