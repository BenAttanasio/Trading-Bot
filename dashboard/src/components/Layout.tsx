import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  statusBar: ReactNode;
}

export function Layout({ children, statusBar }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {statusBar}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
