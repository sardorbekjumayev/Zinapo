'use client';

/**
 * The switch from design/06. A real button with role="switch", so it is
 * reachable by keyboard and announced as on/off; `label` is its accessible name.
 */
export function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="fam-toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}
