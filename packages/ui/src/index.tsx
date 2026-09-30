import type { ReactNode } from "react";

export function Brand({ product }: { product?: string }) {
  return (
    <div className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        N
      </span>
      <span className="brand-name">nagar</span>
      {product ? <span className="brand-product">/{product.toLowerCase()}</span> : null}
    </div>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="status-pill">
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function ProductShell({
  product,
  index,
  tagline,
  actions,
  children,
}: {
  product: string;
  index: string;
  tagline: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="page-shell">
      <header className="topbar">
        <Brand product={product} />
        <span className="topbar-note">
          NAGAR PLATFORM <i>·</i> PHASE 2
        </span>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span>{index}</span> NAGAR / {product.toUpperCase()}
          </p>
          <h1>{tagline}</h1>
          <p className="hero-subtitle">
            A shared foundation for building better software, together.
          </p>
          <div className="hero-actions">
            {actions ?? (
              <a className="primary-link" href="#foundation">
                Explore platform <span>↗</span>
              </a>
            )}
            <StatusPill>Phase 2 · Hub Collaboration</StatusPill>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">
            N<span>·</span>
          </div>
          <span className="orbit-label label-top">ONE IDENTITY</span>
          <span className="orbit-label label-bottom">THREE PRODUCTS</span>
        </div>
      </section>
      <section id="foundation" className="feature-grid" aria-label="Platform foundations">
        {children}
      </section>
      <footer className="footer">
        <span>BUILT FOR THE WAY DEVELOPERS WORK</span>
        <span>
          AJMER, INDIA <i>·</i> EST. 2026
        </span>
      </footer>
    </main>
  );
}

export function FoundationCard({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <article className="foundation-card">
      <span className="card-number">{number}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <span className="card-arrow" aria-hidden="true">
        ↗
      </span>
    </article>
  );
}
