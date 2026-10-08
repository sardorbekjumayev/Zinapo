'use client';

interface Props {
  deepLink: string;
  label: string;
}

export function TelegramButton({ deepLink, label }: Props) {
  return (
    <a className="btn btn--telegram" href={deepLink} target="_blank" rel="noopener noreferrer">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.3-.1-.5-.6-.2L5.3 12.1.5 10.6c-1-.3-1-1 .2-1.5L20.6 2.9c.8-.3 1.6.2 1.3 1.4z" />
      </svg>
      {label}
    </a>
  );
}
