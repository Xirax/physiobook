import { useId } from 'react';

import styles from './TextField.module.scss';

export interface TextFieldProps {
  name: string;
  label: string;
  value: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
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
  error,
  onChange,
  onBlur,
}: TextFieldProps) => {
  const id = useId();
  const errorId = `${id}-error`;

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
        required
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={onBlur}
      />

      {error !== undefined && (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
};
