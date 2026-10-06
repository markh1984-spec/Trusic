import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../auth";

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (admin && !me.user.isAdmin) return <p className="muted">This page is for Trusic admins.</p>;
  return <>{children}</>;
}

export const Loading = () => <p className="muted loading">Loading…</p>;

export const ErrorNote = ({ message }: { message: string }) => (
  <p className="note note--error" role="alert">
    {message}
  </p>
);
