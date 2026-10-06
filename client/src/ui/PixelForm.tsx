import type { CSSProperties, InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react';
import { chromeImage, chromeStyle } from './theme';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  frameStyle?: CSSProperties;
}

/** Single line text input inside the input_frame 9-slice (the native box is fully restyled). */
export function PixelInput({ ref, frameStyle, className, ...rest }: InputProps) {
  return (
    <span className={`px-input ${className ?? ''}`} style={{ ...chromeStyle('input_frame'), ...frameStyle }}>
      <input ref={ref} spellCheck={false} autoComplete="off" {...rest} />
    </span>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  frameStyle?: CSSProperties;
}

/** Multi line input inside the input_frame 9-slice. */
export function PixelTextArea({ ref, frameStyle, className, ...rest }: TextAreaProps) {
  return (
    <span className={`px-input ${className ?? ''}`} style={{ ...chromeStyle('input_frame'), ...frameStyle }}>
      <textarea ref={ref} spellCheck={false} {...rest} />
    </span>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Checkbox drawn with the checkbox_off / checkbox_on sprites. */
export function PixelCheckbox({ checked, onChange, label, disabled, title }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="px-checkbox"
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span style={chromeImage(checked ? 'checkbox_on' : 'checkbox_off')} />
      <span>{label}</span>
    </button>
  );
}
