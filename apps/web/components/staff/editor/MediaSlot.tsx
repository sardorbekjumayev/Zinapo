'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { bankApi } from '@/lib/bank-api';
import type { MediaRef } from '@/lib/bank-types';
import type { EditorMessages } from '@/messages/editor';
import { AUDIO_MAX, IMAGE_MAX, mediaErrorText } from './shared';

const ACCEPT = { image: 'image/png,image/jpeg,image/svg+xml', audio: 'audio/mpeg,.mp3' } as const;

/**
 * One upload slot (design/12 "Picture" / "Read-aloud audio"). The file goes to
 * in-country storage at once (`POST /staff/media`); the draft only keeps the
 * returned ref, saved with the next "Save draft".
 */
export function MediaSlot({
  kind,
  title,
  sub,
  value,
  onChange,
  m,
  readOnly,
  invalid,
  invalidText,
  alt,
  compact = false,
}: {
  kind: 'image' | 'audio';
  title: string;
  sub: string;
  value: MediaRef | null;
  onChange: (next: MediaRef | null) => void;
  m: EditorMessages;
  readOnly: boolean;
  invalid?: boolean;
  invalidText?: string;
  alt: string;
  compact?: boolean;
}) {
  const inputId = useId();
  const msgId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setStatus('');
    // The API refuses these too; checking first saves an upload on mobile data.
    if (file.size === 0) return setError(m.media.eEmpty);
    if (file.size > (kind === 'image' ? IMAGE_MAX : AUDIO_MAX)) return setError(m.media.eSize);
    setBusy(true);
    try {
      const res = await bankApi.upload(kind, file);
      onChange({ ref: res.ref, url: res.url });
      setStatus(m.media.uploaded);
    } catch (err) {
      setError(mediaErrorText(err, m));
    } finally {
      setBusy(false);
    }
  }

  const message = error ?? (invalid ? invalidText : null);

  return (
    <div className={compact ? 'ie-media ie-media--compact' : 'ie-media'} data-invalid={message ? 'true' : undefined}>
      <div className="ie-media__head">
        <span className="ie-media__icon" aria-hidden="true">
          <Icon name={kind === 'image' ? 'file' : 'play'} size={18} />
        </span>
        <div className="ie-media__text">
          <span className="ie-media__title">{title}</span>
          <span className="ie-media__sub">{sub}</span>
        </div>
        {!readOnly && (
          <div className="ie-media__actions">
            <label className="fam-btn fam-btn--sm ie-file" htmlFor={inputId} aria-busy={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? m.media.uploading : value ? m.media.replace : m.media.choose}
            </label>
            <input
              id={inputId}
              type="file"
              className="visually-hidden"
              accept={ACCEPT[kind]}
              disabled={busy}
              aria-describedby={message ? msgId : undefined}
              onChange={pick}
            />
            {value && (
              <button type="button" className="fam-btn fam-btn--sm fam-btn--quiet" onClick={() => onChange(null)}>
                {m.media.remove}
              </button>
            )}
          </div>
        )}
      </div>

      {value ? (
        kind === 'image' ? (
          // A plain <img>: the signed URL is short-lived, so no image optimiser cache.
          <img className="ie-media__img" src={value.url} alt={alt} />
        ) : (
          <audio className="ie-media__audio" controls preload="none" src={value.url} aria-label={title} />
        )
      ) : (
        readOnly && <span className="fam-small fam-muted">{m.media.none}</span>
      )}

      {message && (
        <p id={msgId} className="fam-caption fam-caption--bad" role={error ? 'alert' : undefined}>
          {message}
        </p>
      )}
      <span className="visually-hidden" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
