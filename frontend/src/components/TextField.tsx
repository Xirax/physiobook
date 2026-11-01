import { useId } from 'react';

import styles from './TextField.module.scss';

export interface TextFieldProps {
  name: string;
  label: string;
  value: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  inputMode?: 'text' | 'numeric';
  /** The id of a `<datalist>` offering suggestions without restricting the value. */
  list?: string;
  hint?: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export const TextField = ({
  name,
  label,
  value,
  type = 'text',
  autoComplete,
  inputMode,
  list,
  hint,
  error,
  onChange,
  onBlur,
}: TextFieldProps) => {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((part) => part !== null)
    .join(' ');

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <input
        className={styles.input}
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        list={list}
        required
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={onBlur}
      />

      {hint !== undefined && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}

      {error !== undefined && (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
};
