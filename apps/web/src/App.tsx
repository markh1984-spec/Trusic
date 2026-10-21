import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/Admin";
import { ArtistPage } from "./pages/Artist";
import { ArtistStatsPage } from "./pages/ArtistStats";
import { TrackStatsPage } from "./pages/TrackStats";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { LibraryPage, LikedPage } from "./pages/Library";
import { MoneyPage } from "./pages/Money";
import { NotFoundPage } from "./pages/NotFound";
import { PlaylistPage } from "./pages/Playlist";
import { ReleasePage } from "./pages/Release";
import { ReleaseEditorPage } from "./pages/ReleaseEditor";
import { SearchPage } from "./pages/Search";
import { StudioPage } from "./pages/Studio";
import { TrackPage } from "./pages/Track";
import { TransparencyPage } from "./pages/Transparency";
import { UploadPage } from "./pages/Upload";
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "./pages/AccountRecovery";
import { CopyrightPage, TermsPage } from "./pages/Legal";
import { ReporterReplyPage, ReportPage } from "./pages/Report";
import { SettingsPage } from "./pages/Settings";
import { TakedownPage } from "./pages/Takedown";
import "./accounts.css";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="track/:id" element={<TrackPage />} />
        <Route path="artist/:slug" element={<ArtistPage />} />
        <Route path="release/:id" element={<ReleasePage />} />
        <Route path="playlist/:id" element={<PlaylistPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="liked" element={<LikedPage />} />
        <Route path="transparency" element={<TransparencyPage />} />
        <Route path="money" element={<MoneyPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="studio/release/:id" element={<ReleaseEditorPage />} />
        <Route path="studio/artist/:id" element={<ArtistStatsPage />} />
        <Route path="studio/track/:id" element={<TrackStatsPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        {/* Accounts, reports and takedowns */}
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="report/reply/:id" element={<ReporterReplyPage />} />
        <Route path="report/:type/:id" element={<ReportPage />} />
        <Route path="takedown/:id" element={<TakedownPage />} />
        <Route path="legal/copyright" element={<CopyrightPage />} />
        <Route path="legal/terms" element={<TermsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
