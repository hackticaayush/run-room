import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { IconName } from '../assets/manifest';
import { PixelIcon } from './PixelSprite';

interface PixelButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: IconName;
  label?: ReactNode;
  /** Stays pressed (toggle buttons such as the active speed). */
  active?: boolean;
  size?: 'md' | 'lg';
  tone?: 'default' | 'danger' | 'accent';
  iconSize?: 1 | 2 | 3;
  children?: ReactNode;
}

/** Button drawn with the generated 9-slice chrome (up / hover / down / disabled). */
export function PixelButton({
  icon,
  label,
  active,
  size = 'md',
  tone = 'default',
  iconSize,
  className,
  children,
  type = 'button',
  ...rest
}: PixelButtonProps) {
  const iconOnly = icon && !label && !children;
  const classes = [
    'px-button',
    size === 'lg' ? 'px-button--lg' : '',
    iconOnly ? 'px-button--icon' : '',
    tone !== 'default' ? `px-button--${tone}` : '',
    active ? 'is-active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} aria-pressed={active === undefined ? undefined : active} {...rest}>
      {icon && <PixelIcon name={icon} size={iconSize ?? (size === 'lg' ? 2 : 1)} />}
      {label && <span className="px-button-label">{label}</span>}
      {children}
    </button>
  );
}
