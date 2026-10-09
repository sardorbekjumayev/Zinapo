import { fill } from '@/lib/i18n';
import type { AnswerInput, BundleItem, BundleOption } from '@/lib/session-types';
import type { KidMessages } from '@/messages/kid';
import type { LocalAnswer } from './storage';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export type StemLang = 'uz' | 'ru';

export const stemOf = (it: BundleItem, lang: StemLang) => (lang === 'ru' ? it.stemRu || it.stemUz : it.stemUz || it.stemRu);
export const labelOf = (o: BundleOption, lang: StemLang) => (lang === 'ru' ? o.labelRu || o.labelUz : o.labelUz || o.labelRu);
export const audioOf = (it: BundleItem, lang: StemLang) =>
  lang === 'ru' ? it.audioUrlRu ?? it.audioUrlUz : it.audioUrlUz ?? it.audioUrlRu;

/** What the API accepts (sessions.dto.ts): integers, revisionCount ≤ 1000, responseMs ≤ 1 h. */
export function toInput(a: LocalAnswer): AnswerInput {
  return {
    itemVersionId: a.itemVersionId,
    chosenOptionId: a.chosenOptionId,
    flagged: a.flagged,
    revisionCount: Math.min(1000, Math.max(0, Math.round(a.revisionCount))),
    responseMs: Math.min(3_600_000, Math.max(0, Math.round(a.responseMs))),
    clientRecordedAt: a.clientRecordedAt,
  };
}

/** A short device summary for `session.device` / `os` (task.md § 8.3), never the raw UA. */
export function deviceInfo(): { device: string; os: string; clientVersion: string } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const pick = (re: RegExp) => ua.match(re)?.[1];
  const os =
    (pick(/Android ([\d.]+)/) && `Android ${pick(/Android ([\d.]+)/)}`) ||
    (pick(/(?:iPhone|iPad|iPod).*? OS ([\d_]+)/) && `iOS ${pick(/OS ([\d_]+)/)!.replace(/_/g, '.')}`) ||
    (/Windows/.test(ua) && 'Windows') ||
    (/Mac OS X/.test(ua) && 'macOS') ||
    (/CrOS/.test(ua) && 'ChromeOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    'unknown';
  const browser =
    (pick(/Edg\/(\d+)/) && `Edge ${pick(/Edg\/(\d+)/)}`) ||
    (pick(/OPR\/(\d+)/) && `Opera ${pick(/OPR\/(\d+)/)}`) ||
    (pick(/YaBrowser\/(\d+)/) && `Yandex ${pick(/YaBrowser\/(\d+)/)}`) ||
    (pick(/Firefox\/(\d+)/) && `Firefox ${pick(/Firefox\/(\d+)/)}`) ||
    (pick(/Chrome\/(\d+)/) && `Chrome ${pick(/Chrome\/(\d+)/)}`) ||
    (pick(/Version\/(\d+).*Safari/) && `Safari ${pick(/Version\/(\d+).*Safari/)}`) ||
    'browser';
  const kind = /Mobi|Android|iPhone|iPod/.test(ua) ? 'mobile' : /iPad|Tablet/.test(ua) ? 'tablet' : 'desktop';
  return { device: `${browser} · ${kind}`.slice(0, 120), os: os.slice(0, 60), clientVersion: 'web-m4' };
}

/** "58 daq." / "1 soat 20 daq." / "0:42" in the last minute. */
export function formatRemaining(ms: number, t: KidMessages): string {
  if (ms <= 0) return t.timeUp;
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `0:${String(sec).padStart(2, '0')}`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return fill(t.timeMin, { n: min });
  return fill(t.timeHm, { h: Math.floor(min / 60), m: min % 60 });
}
