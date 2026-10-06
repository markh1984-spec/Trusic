import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/Admin";
import { ArtistPage } from "./pages/Artist";
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
        <Route path="upload" element={<UploadPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
