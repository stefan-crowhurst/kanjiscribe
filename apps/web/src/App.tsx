import { Link, NavLink, Route, Routes } from 'react-router-dom';

import { BacklogPage } from './pages/BacklogPage.js';
import { KanjiIcon } from './components/KanjiIcon.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { DayDetailPage } from './pages/DayDetailPage.js';
import { DrillPage } from './pages/DrillPage.js';
import { IntakePage } from './pages/IntakePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { WordViewPage } from './pages/WordViewPage.js';

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand-link">
          <div>
            <h1 className="brand-title">
              <img src="/brand-mark.svg" alt="" aria-hidden="true" className="brand-mark" />
              <span>kanjiscribe</span>
            </h1>
            <p>Companion kanji drill workspace</p>
          </div>
        </Link>
        <nav>
          <NavLink to="/">
            <span className="nav-link-content">
              <KanjiIcon literal="前" className="nav-kanji" />
              <span>Dashboard</span>
            </span>
          </NavLink>
          <NavLink to="/intake">
            <span className="nav-link-content">
              <KanjiIcon literal="新" className="nav-kanji" />
              <span>Intake</span>
            </span>
          </NavLink>
          <NavLink to="/today">
            <span className="nav-link-content">
              <KanjiIcon literal="今" className="nav-kanji" />
              <span>Today</span>
            </span>
          </NavLink>
          <NavLink to="/backlog">
            <span className="nav-link-content">
              <KanjiIcon literal="残" className="nav-kanji" />
              <span>Backlog</span>
            </span>
          </NavLink>
          <NavLink to="/settings">
            <span className="nav-link-content">
              <KanjiIcon literal="誉" className="nav-kanji" />
              <span>Data Sources</span>
            </span>
          </NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/drill/:assignmentId" element={<DrillPage />} />
          <Route path="/day/:date" element={<DayDetailPage />} />
          <Route path="/word/:assignmentId" element={<WordViewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
