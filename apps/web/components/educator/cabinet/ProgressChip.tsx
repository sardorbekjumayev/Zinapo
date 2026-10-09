import type { GainCategory } from '@/lib/educator-types';
import { PROGRESS_CHIP } from './labels';

/** design/08's change pill, as words only: no points, no position (task.md § 3, rule 1.9). */
export function ProgressChip({ value, label }: { value: GainCategory; label: string }) {
  return <span className={PROGRESS_CHIP[value]}>{label}</span>;
}
