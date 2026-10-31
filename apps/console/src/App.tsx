import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toasts } from './components/ui/Toasts';
import { TopBar } from './components/TopBar';
import { http, setCsrfToken } from './services/http';
import { realtime } from './services/realtime';
import { useSessionStore } from './store/session';
import { LoginPage } from './pages/LoginPage';
import { CasesPage } from './pages/CasesPage';
import { PlanningPage } from './pages/PlanningPage';
import { ProcedurePage } from './pages/ProcedurePage';
import { ReviewPage } from './pages/ReviewPage';
import { AdminPage } from './pages/AdminPage';

function Splash({ label = '正在初始化监督控制台' }: { label?: string }) {
  return (
    <div className="splash">
      <div className="splash__mark">
        <span className="splash__ring" />
        <span className="splash__dot" />
      </div>
      <div className="splash__name">MAGNAV</div>
      <div className="splash__label">{label}</div>
      <div className="splash__bar">
        <span />
      </div>
      <div className="splash__foot">磁控介入手术机器人 · 监督控制台 · Web 全栈</div>
    </div>
  );
}

function AppShell() {
  const user = useSessionStore((s) => s.user);
  useEffect(() => {
    if (!user) return;
    realtime.connect();
    return () => {
      realtime.disconnect();
    };
  }, [user]);

  return (
    <div className="app-shell">
      <TopBar />
      <main className="app-main">
        <Outlet />
      </main>
      <Toasts />
    </div>
  );
}

function RequireAuth() {
  const boot = useSessionStore((s) => s.boot);
  const user = useSessionStore((s) => s.user);
  const location = useLocation();
  if (boot === 'loading') return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

export function App() {
  const boot = useSessionStore((s) => s.boot);
  const user = useSessionStore((s) => s.user);
  const setBoot = useSessionStore((s) => s.setBoot);
  const setAuth = useSessionStore((s) => s.setAuth);
  const logout = useSessionStore((s) => s.logout);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    http
      .me()
      .then((result) => {
        if (cancelled) return;
        setAuth(result.user, result.csrfToken);
      })
      .catch(() => {
        if (cancelled) return;
        setCsrfToken(null);
        setBoot('anon');
      });
    return () => {
      cancelled = true;
    };
  }, [setAuth, setBoot]);

  useEffect(() => {
    const handler = () => {
      logout();
      realtime.disconnect();
      navigate('/login');
    };
    window.addEventListener('magnav:auth-expired', handler);
    return () => window.removeEventListener('magnav:auth-expired', handler);
  }, [logout, navigate]);

  useEffect(() => {
    const unlock = () => {
      void import('./services/audio').then((mod) => mod.initAudio());
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (boot === 'loading') return <Splash label="正在校验会话与设备状态" />;

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/cases" replace />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/case/:caseId/plan" element={<PlanningPage />} />
          <Route path="/case/:caseId/procedure" element={<ProcedurePage />} />
          <Route path="/case/:caseId/review" element={<ReviewPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/cases" replace />} />
        </Route>
      </Routes>
    </>
  );
}
