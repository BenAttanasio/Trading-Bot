import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
  statusBar: ReactNode;
}

export function Layout({ children, sidebar, statusBar }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Status Bar */}
      {statusBar}

      <div className="flex flex-1">
        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {children}
        </main>

        {/* Sidebar */}
        <aside className="w-72 lg:w-80 border-l border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-4 hidden md:block overflow-y-auto">
          {sidebar}
        </aside>
      </div>
    </div>
  );
}
