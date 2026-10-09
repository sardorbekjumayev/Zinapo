/** design/14's anchor mark. Local: the shell's icon set has no anchor. */
export function AnchorGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V21M8 11h8M4.5 14a7.5 7.5 0 0 0 15 0" />
    </svg>
  );
}
