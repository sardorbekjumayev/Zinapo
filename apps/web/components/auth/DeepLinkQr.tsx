'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  value: string;
  label: string;
}

/**
 * Desktop users usually have Telegram only on their phone, so the deep link is
 * also offered as a QR code. Hidden under 960 px by CSS.
 */
export function DeepLinkQr({ value, label }: Props) {
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!svg) return null;

  return (
    <div className="qr">
      {/* qrcode generates the markup locally; no third-party content involved. */}
      <div className="qr__code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="qr__label">{label}</p>
    </div>
  );
}
