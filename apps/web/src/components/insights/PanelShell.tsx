export function PanelShell({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`insights-panel ${className}`}>
      <header className="insights-panel__header">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function PanelLoading({ title }: { title: string }) {
  return (
    <PanelShell title={title}>
      <p className="insights-muted">Loading…</p>
    </PanelShell>
  );
}
