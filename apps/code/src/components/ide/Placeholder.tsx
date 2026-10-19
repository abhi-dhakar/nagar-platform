"use client";

export function Placeholder({
  icon,
  title,
  description,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ide-placeholder">
      {icon ? <div className="ide-placeholder-icon">{icon}</div> : null}
      <h3 className="ide-placeholder-title">{title}</h3>
      <p className="ide-placeholder-desc">{description}</p>
      {hint ? <p className="ide-placeholder-hint">{hint}</p> : null}
      {action ? <div className="ide-placeholder-action">{action}</div> : null}
      <p className="ide-placeholder-foot">
        This panel is reserved for a future phase. No mock data is shown as real.
      </p>
    </div>
  );
}
