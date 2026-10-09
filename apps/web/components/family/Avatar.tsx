import { initials } from '@/lib/format';

/** Initials in a tinted circle — design/06 tints owners violet, co-guardians blue, tutors teal. */
export function Avatar({
  name,
  tone = 'brand',
  size = 'md',
}: {
  name: string;
  tone?: 'brand' | 'blue' | 'teal';
  size?: 'md' | 'lg';
}) {
  const cls = ['fam-avatar'];
  if (tone !== 'brand') cls.push(`fam-avatar--${tone}`);
  if (size === 'lg') cls.push('fam-avatar--lg');
  return (
    <span className={cls.join(' ')} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
