import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "error";
}

export function EmptyState({ icon: Icon, title, description, action, tone = "default" }: Props) {
  return (
    <div className={`empty-state${tone === "error" ? " is-error" : ""}`} role="status">
      <Icon className="empty-state-icon" aria-hidden="true" />
      <div className="empty-state-title">{title}</div>
      {description ? <div className="empty-state-desc">{description}</div> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
