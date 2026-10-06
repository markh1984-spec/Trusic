import { useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth";
import { Icon, type IconName } from "./Icon";
import { PlayerBar } from "./PlayerBar";

function NavItem({ to, icon, children }: { to: string; icon: IconName; children: string }) {
  return (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}>
      <Icon name={icon} />
      <span>{children}</span>
    </NavLink>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="logo" aria-label="Trusic home">
          <span className="logo__mark">T</span>
          <span className="logo__word">Trusic</span>
        </Link>
        <nav className="nav">
          <NavItem to="/" icon="home">
            Home
          </NavItem>
          <NavItem to="/search" icon="search">
            Search
          </NavItem>
          <NavItem to="/transparency" icon="chart">
            Transparency
          </NavItem>
          {me ? (
            <>
              <div className="nav__heading">You</div>
              <NavItem to="/money" icon="money">
                Your money
              </NavItem>
              <NavItem to="/studio" icon="studio">
                Studio
              </NavItem>
              <NavItem to="/upload" icon="upload">
                Upload
              </NavItem>
              {me.user.isAdmin ? (
                <NavItem to="/admin" icon="shield">
                  Admin
                </NavItem>
              ) : null}
            </>
          ) : null}
        </nav>
        <div className="sidebar__promise">
          <strong>80% to artists.</strong> Each listener's money only reaches artists they actually played, and
          human-made music earns more.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <form className="search" onSubmit={onSearch} role="search">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="Search tracks, artists, genres"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </form>
          <div className="topbar__account">
            {me ? (
              <>
                <span className={`plan-pill plan-pill--${me.user.plan}`}>
                  {me.user.plan === "premium" ? "Premium" : "Free"}
                </span>
                <span className="topbar__name">
                  <Icon name="person" size={18} /> {me.user.displayName}
                </span>
                <button className="icon-button" onClick={() => void logout()} aria-label="Log out" title="Log out">
                  <Icon name="logout" />
                </button>
              </>
            ) : (
              <>
                <Link to="/register" className="button button--ghost">
                  Sign up
                </Link>
                <Link to="/login" className="button">
                  Log in
                </Link>
              </>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>

      <PlayerBar />
    </div>
  );
}
