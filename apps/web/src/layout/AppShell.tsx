import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth';

export function AppShell() {
  const { state, logout } = useAuth();
  const email = state.status === 'signed-in' ? state.user.email : '';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900/40 p-4 flex flex-col">
        <div className="px-2 py-1 text-lg font-semibold tracking-tight">Nexus</div>
        <nav className="mt-4 space-y-1 text-sm">
          <SideLink to="/" label="Dashboard" />
          <SideLink to="/agents" label="Agents" />
          <SideLink to="/conversations" label="Conversations" />
          <SideLink to="/analytics" label="Analytics" />
        </nav>
        <div className="mt-auto pt-4 border-t border-zinc-800 text-xs text-zinc-400">
          <div data-testid="signed-in-as" className="px-2 truncate">
            {email}
          </div>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="mt-2 w-full rounded-md border border-zinc-700 px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}

function SideLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `block rounded-md px-2 py-1.5 ${
          isActive ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-800/60'
        }`
      }
    >
      {label}
    </NavLink>
  );
}
