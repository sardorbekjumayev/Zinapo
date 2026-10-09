import { Icon } from '@/components/shell/Icon';
import type { PracticeMessages } from '@/messages/practice';

/**
 * design/09's teal band. task.md § 7.1: practice must look different from
 * monitoring in layout and wording, not only in colour — so every practice
 * screen opens with what it is for.
 */
export function ModeBanner({ m }: { m: PracticeMessages['mode'] }) {
  return (
    <div className="pr-mode" role="note">
      <span className="pr-mode__tag">
        <Icon name="list" size={16} />
        {m.tag}
      </span>
      <span className="pr-mode__note">{m.note}</span>
    </div>
  );
}
