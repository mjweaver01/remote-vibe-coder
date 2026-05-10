import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: 'default' | 'primary' | 'danger';
  size?: 'sm' | 'md';
}

export function IconButton({
  icon: Icon,
  label,
  tone = 'default',
  size = 'md',
  className = '',
  ...rest
}: Props) {
  const cls = [
    'icon-btn',
    `icon-btn-${tone}`,
    `icon-btn-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" aria-label={label} title={label} className={cls} {...rest}>
      <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />
    </button>
  );
}
