import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/Admin";
import { ArtistPage } from "./pages/Artist";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { MoneyPage } from "./pages/Money";
import { NotFoundPage } from "./pages/NotFound";
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
        <Route path="transparency" element={<TransparencyPage />} />
        <Route path="money" element={<MoneyPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
