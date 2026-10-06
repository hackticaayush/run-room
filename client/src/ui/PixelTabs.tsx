import type { ReactNode } from 'react';
import type { IconName } from '../assets/manifest';
import { PixelIcon } from './PixelSprite';

export interface PixelTab<T extends string> {
  id: T;
  label: ReactNode;
  icon?: IconName;
}

interface TabsProps<T extends string> {
  tabs: PixelTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
}

/** Tab strip drawn with tab_active / tab_inactive chrome. */
export function PixelTabs<T extends string>({ tabs, value, onChange, label }: TabsProps<T>) {
  return (
    <div className="px-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className={`px-tab ${t.id === value ? 'is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <PixelIcon name={t.icon} size={1} />}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
