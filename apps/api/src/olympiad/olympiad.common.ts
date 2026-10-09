/** task.md § 8.5: the four stages, in season order. */
export const STAGE_ORDER = ['autumn_online', 'mini_final', 'spring_online', 'spring_final'] as const;
export type StageKind = (typeof STAGE_ORDER)[number];

/** Taken at home, unsupervised: no big prizes, only a way into the next stage. */
export const ONLINE_STAGES: StageKind[] = ['autumn_online', 'spring_online'];
/** In person at a venue, with a proctor — "the one supervised measurement". */
export const IN_PERSON_STAGES: StageKind[] = ['mini_final', 'spring_final'];

/** § 8.1.6: "≥ 3 monitoring waves = direct entry to the spring final". */
export const TICKET_WAVES = 3;

/**
 * The response-time signal (§ 12 M7) on an unsupervised stage: answers this
 * fast AND this accurate are worth a human look. A flag for trust & safety —
 * never an automatic disqualification.
 */
export const FAST_MEDIAN_MS = 4000;
export const FAST_MIN_SHARE_CORRECT = 0.8;

export type StageState = 'upcoming' | 'registration' | 'open' | 'closed';

export function stageState(s: { opens_at: Date; closes_at: Date }, now = Date.now()): StageState {
  if (now >= s.closes_at.getTime()) return 'closed';
  if (now >= s.opens_at.getTime()) return 'open';
  return 'upcoming';
}

/** Registration runs until `registration_closes_at`, or the stage's close if none is set. */
export function registrationOpen(s: { closes_at: Date; registration_closes_at: Date | null }, now = Date.now()): boolean {
  return now < (s.registration_closes_at ?? s.closes_at).getTime();
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
