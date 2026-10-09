import { BankApiError } from '@/lib/bank-api';
import type {
  Cluster,
  DraftPatch,
  ItemCard,
  ItemStatus,
  ItemVersion,
  MediaRef,
  Misconception,
  StemFormat,
  Taxonomy,
  Topic,
} from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';

export const CLUSTERS: Cluster[] = ['numeracy', 'reasoning', 'language'];
export const GRADES = [0, 1, 2, 3, 4];
export const MIN_OPTIONS = 3;
export const MAX_OPTIONS = 5;
export const IMAGE_MAX = 2 * 1024 * 1024;
export const AUDIO_MAX = 3 * 1024 * 1024;

export const letter = (i: number) => 'ABCDE'[i] ?? String(i + 1);

/** Grades 0–1 get visual items with read-aloud audio (task.md § 8.3). */
export const isYoung = (grade: number) => grade <= 1;
/** Grades 0–2 are measured by skill (INV-11). */
export const needsSkill = (grade: number) => grade <= 2;

export interface DraftOption {
  labelUz: string;
  labelRu: string;
  image: MediaRef | null;
  isKey: boolean;
  misconceptionCode: string;
  rationale: string;
}

/** What the editor holds. `cluster` is UI-only: the API derives it from the topic. */
export interface Draft {
  grade: number;
  cluster: Cluster | null;
  topicCode: string;
  skillCode: string;
  construct: string;
  stemFormat: StemFormat;
  stemUz: string;
  stemRu: string;
  image: MediaRef | null;
  audioUz: MediaRef | null;
  audioRu: MediaRef | null;
  /** As typed — "0,45" in uz/ru. Parsed only on save. */
  expectedP: string;
  options: DraftOption[];
}

export function topicName(t: Pick<Topic, 'nameUz' | 'nameRu'>, locale: Locale): string {
  // Taxonomy names exist in uz and ru only; en reads the uz master.
  return locale === 'ru' ? t.nameRu : t.nameUz;
}

export function misconceptionName(m: Pick<Misconception, 'nameUz' | 'nameRu'>, locale: Locale): string {
  return locale === 'ru' ? m.nameRu : m.nameUz;
}

export function formatNum(n: number, locale: Locale, digits = 2): string {
  const s = n.toFixed(digits);
  return locale === 'en' ? s : s.replace('.', ',');
}

/** "0,45" / "0.45" → 0.45; '' → null; anything else (or outside 0–1) → undefined. */
export function parseP(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  if (!/^\d*\.?\d+$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return Math.round(n * 1000) / 1000;
}

export function topicsFor(tax: Taxonomy, grade: number | null, cluster: Cluster | null): Topic[] {
  if (grade === null || !cluster) return [];
  return tax.topics
    .filter((t) => t.cluster === cluster && grade >= t.gradeMin && grade <= t.gradeMax)
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
}

export function skillsFor(tax: Taxonomy, grade: number | null, topicCode: string) {
  if (grade === null || !needsSkill(grade) || !topicCode) return [];
  return tax.skills.filter((s) => s.topicCode === topicCode && s.grade === grade);
}

export function fromVersion(card: ItemCard, v: ItemVersion, tax: Taxonomy, locale: Locale): Draft {
  const cluster = card.cluster ?? tax.topics.find((t) => t.code === card.topicCode)?.cluster ?? null;
  return {
    grade: card.grade,
    cluster,
    topicCode: card.topicCode,
    skillCode: card.skillCode ?? '',
    construct: card.construct,
    stemFormat: v.stemFormat,
    stemUz: v.stemUz,
    stemRu: v.stemRu,
    image: v.image,
    audioUz: v.audioUz,
    audioRu: v.audioRu,
    expectedP: v.expectedP === null ? '' : locale === 'en' ? String(v.expectedP) : String(v.expectedP).replace('.', ','),
    options: v.options.map((o) => ({
      labelUz: o.labelUz,
      labelRu: o.labelRu,
      image: o.image,
      isKey: !!o.isKey,
      misconceptionCode: o.misconceptionCode ?? '',
      rationale: o.rationale ?? '',
    })),
  };
}

/** The whole draft, every time. Item fields only while they are still editable. */
export function toPatch(d: Draft, withItemFields: boolean): DraftPatch {
  const expectedP = parseP(d.expectedP);
  const patch: DraftPatch = {
    stemFormat: d.stemFormat,
    stemUz: d.stemUz,
    stemRu: d.stemRu,
    imageRef: d.image?.ref ?? null,
    audioRefUz: d.audioUz?.ref ?? null,
    audioRefRu: d.audioRu?.ref ?? null,
    expectedP: expectedP === undefined ? null : expectedP,
    options: d.options.map((o) => ({
      labelUz: o.labelUz,
      labelRu: o.labelRu,
      imageRef: o.image?.ref ?? null,
      isKey: o.isKey,
      misconceptionCode: o.isKey ? null : o.misconceptionCode || null,
      rationale: o.isKey ? null : o.rationale,
    })),
  };
  if (withItemFields) {
    patch.grade = d.grade;
    patch.topicCode = d.topicCode;
    patch.skillCode = needsSkill(d.grade) ? d.skillCode || null : null;
    if (d.construct.trim()) patch.construct = d.construct.trim();
  }
  return patch;
}

/**
 * The same checks `POST /submit` runs (apps/api items.service `incompleteFields`),
 * so the "Fix before submitting" list updates as the author fixes things.
 */
export function validate(d: Draft, live: Set<string>): string[] {
  const out: string[] = [];
  if (!d.construct.trim()) out.push('construct');
  const p = parseP(d.expectedP);
  if (p === null || p === undefined) out.push('expectedP');
  if (isYoung(d.grade) && d.stemFormat !== 'image_audio') out.push('stemFormat');
  if (d.stemFormat !== 'text' && !d.image) out.push('image');
  if (d.stemFormat === 'image_audio') {
    if (!d.audioUz) out.push('audioUz');
    if (!d.audioRu) out.push('audioRu');
  }
  if (!d.stemUz.trim()) out.push('stemUz');
  if (!d.stemRu.trim()) out.push('stemRu');
  if (d.options.length < MIN_OPTIONS || d.options.length > MAX_OPTIONS) out.push('options');
  if (d.options.filter((o) => o.isKey).length !== 1) out.push('correct');
  d.options.forEach((o, i) => {
    const n = i + 1;
    if (!o.labelUz.trim() && !o.image) out.push(`options.${n}.labelUz`);
    if (!o.labelRu.trim() && !o.image) out.push(`options.${n}.labelRu`);
    if (!o.isKey) {
      if (!o.misconceptionCode || !live.has(o.misconceptionCode)) out.push(`options.${n}.misconception`);
      if (!o.rationale.trim()) out.push(`options.${n}.rationale`);
    }
  });
  return out;
}

/** design/12 summary chips: "B: error type", "Stem (ru)" … */
export function fieldLabel(key: string, m: EditorMessages): string {
  const opt = /^options\.(\d+)\.(labelUz|labelRu|misconception|rationale)$/.exec(key);
  if (opt) return fill(m.sum[opt[2] as 'labelUz'], { L: letter(Number(opt[1]) - 1) });
  return (m.sum as Record<string, string>)[key] ?? key;
}

export function errorText(err: unknown, m: EditorMessages): string {
  if (!(err instanceof BankApiError)) return m.errors.generic;
  const known = m.errors as Record<string, string>;
  const reason = typeof err.details.reason === 'string' ? err.details.reason : null;
  if (reason && known[reason]) return known[reason];
  if (err.code === 'MEDIA_INVALID') return mediaErrorText(err, m);
  return known[err.code] ?? m.errors.generic;
}

export function mediaErrorText(err: unknown, m: EditorMessages): string {
  if (err instanceof BankApiError) {
    if (err.code === 'NETWORK') return m.errors.NETWORK;
    const reason = err.details.reason;
    if (reason === 'type' || reason === 'kind') return m.media.eType;
    if (reason === 'size') return m.media.eSize;
    if (reason === 'empty') return m.media.eEmpty;
  }
  return m.media.eFailed;
}

export const STATUS_CHIP: Record<ItemStatus, string> = {
  draft: 'chip--neutral',
  in_review: 'chip--warning',
  accepted: 'chip--monitoring',
  approved: 'chip--success',
  rejected: 'chip--danger',
  retired: 'chip--neutral',
};
