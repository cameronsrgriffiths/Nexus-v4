import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/auth';
import { AppShell } from './layout/AppShell';
import { Agents } from './pages/Agents';
import { Conversations } from './pages/Conversations';
import { Dashboard } from './pages/Dashboard';
import { Knowledge } from './pages/Knowledge';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/knowledge" element={<Knowledge />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function RequireAuth() {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <div
        data-testid="auth-loading"
        className="min-h-screen bg-zinc-950 text-zinc-400 flex items-center justify-center"
      >
        Loading…
      </div>
    );
  }
  if (state.status === 'signed-out') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
