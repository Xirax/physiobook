export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export type MailTemplate<T> = (data: T) => MailContent;

/**
 * What a template says, before it is rendered. Each paragraph is plain text; a
 * newline inside one is a line break, which is how a list is written.
 */
export interface MailBody {
  subject: string;
  paragraphs: string[];
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

function renderHtml({ subject, paragraphs }: MailBody): string {
  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`,
    )
    .join('');

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(subject)}</title></head>` +
    '<body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2933">' +
    `${body}</body></html>`
  );
}

/**
 * Builds a template whose text and HTML parts come from the same paragraphs, so
 * the two can never say different things — and whose HTML escapes every value,
 * so a patient's name cannot inject markup into a mail.
 */
export function defineTemplate<T>(compose: (data: T) => MailBody): MailTemplate<T> {
  return (data) => {
    const body = compose(data);

    return {
      subject: body.subject,
      text: body.paragraphs.join('\n\n'),
      html: renderHtml(body),
    };
  };
}
