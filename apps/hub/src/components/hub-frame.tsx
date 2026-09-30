import Link from "next/link";
import { Brand } from "@nagar/ui";
import type { ReactNode } from "react";

export function HubFrame({ children }: { children: ReactNode }) {
  return (
    <main className="hub-app">
      <header className="hub-nav">
        <Link href="/" className="nav-brand" aria-label="NagarHub home">
          <Brand product="hub" />
        </Link>
        <nav className="nav-links" aria-label="Main navigation">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/organizations">Organizations</Link>
          <Link href="/notifications">Inbox</Link>
          <Link href="/new">New repository</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>
      {children}
      <footer className="hub-footer">
        <span>NAGARHUB · COLLABORATION BUILD</span>
        <span>GIT, BUILT TOGETHER.</span>
      </footer>
    </main>
  );
}
