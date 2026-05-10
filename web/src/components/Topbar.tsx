import type { ReactNode } from 'react';

interface Props {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}

export function Topbar({ leading, title, subtitle, trailing }: Props) {
  return (
    <header className="topbar">
      {leading ? <div className="topbar-leading">{leading}</div> : null}
      <div className="topbar-titles">
        <div className="topbar-title">{title}</div>
        {subtitle ? <div className="topbar-subtitle">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="topbar-trailing">{trailing}</div> : null}
    </header>
  );
}
