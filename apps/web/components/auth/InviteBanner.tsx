import { fill, Messages } from '@/lib/i18n';

interface Props {
  name: string;
  code: string;
  messages: Messages;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Shown when the user arrives from an invite link (`?invite=NAME&code=XXX`). */
export function InviteBanner({ name, code, messages }: Props) {
  return (
    <div className="invite">
      <span className="invite__avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <div>
        <p className="invite__title">{fill(messages.invite.title, { name, code })}</p>
        <p className="invite__body">{messages.invite.body}</p>
      </div>
    </div>
  );
}
