import { useState, type FormEvent } from 'react';
import type { z } from 'zod';

import { ApiError } from './api-client';

export type FormValues = Record<string, string>;

export interface FieldProps {
  name: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export interface ZodFormOptions<Values extends FormValues> {
  schema: z.ZodType<Values>;
  initialValues: Values;
  onSubmit: (values: Values) => Promise<void>;
  describeError: (error: unknown) => string;
}

export interface ZodForm<Values extends FormValues> {
  formError: string | null;
  pending: boolean;
  /** Differs from the initial values, or from the last values a submit landed. */
  dirty: boolean;
  fieldProps: (name: keyof Values & string) => FieldProps;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const firstIssuePerField = <Values extends FormValues>(
  schema: z.ZodType<Values>,
  values: Values,
): FormValues => {
  const result = schema.safeParse(values);

  if (result.success) return {};

  const errors: FormValues = {};

  for (const { path, message } of result.error.issues) {
    const field = path[0];

    if (typeof field === 'string' && !(field in errors)) errors[field] = message;
  }

  return errors;
};

const fieldErrorsFromApi = (error: unknown): FormValues => {
  if (!(error instanceof ApiError)) return {};

  const errors: FormValues = {};

  for (const { path, message } of error.details) {
    if (!(path in errors)) errors[path] = message;
  }

  return errors;
};

const focusFirstInvalid = (form: HTMLFormElement, errors: FormValues) => {
  for (const control of Array.from(form.elements)) {
    const name = control.getAttribute('name');

    if (name !== null && errors[name] !== undefined && control instanceof HTMLElement) {
      control.focus();

      return;
    }
  }
};

export function useZodForm<Values extends FormValues>({
  schema,
  initialValues,
  onSubmit,
  describeError,
}: ZodFormOptions<Values>): ZodForm<Values> {
  const [values, setValues] = useState(initialValues);
  const [baseline, setBaseline] = useState(initialValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [rejected, setRejected] = useState<FormValues>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const invalid = firstIssuePerField(schema, values);
  const dirty = Object.keys(values).some((name) => values[name] !== baseline[name]);

  const fieldProps = (name: keyof Values & string): FieldProps => ({
    name,
    value: values[name] ?? '',
    error: submitted || touched[name] === true ? (invalid[name] ?? rejected[name]) : undefined,

    onChange: (next) => {
      setValues((previous) => ({ ...previous, [name]: next }));
      setFormError(null);

      setRejected(({ [name]: _replaced, ...rest }) => rest);
    },

    onBlur: () => {
      setTouched((previous) => ({ ...previous, [name]: true }));
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;

    setSubmitted(true);
    setFormError(null);
    setRejected({});

    const parsed = schema.safeParse(values);

    if (!parsed.success) {
      focusFirstInvalid(form, invalid);

      return;
    }

    setPending(true);

    const submitted = values;

    void onSubmit(parsed.data)
      .then(() => {
        setBaseline(submitted);
      })
      .catch((error: unknown) => {
        setRejected(fieldErrorsFromApi(error));
        setFormError(describeError(error));
      })
      .finally(() => {
        setPending(false);
      });
  };

  return { formError, pending, dirty, fieldProps, handleSubmit };
}
