/** The Double Take mark (two stacked frames with a play triangle), for web pages. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Double Take">
      <rect x="3" y="7" width="17" height="22" rx="5" stroke="currentColor" strokeWidth="2.4" opacity="0.55" />
      <rect x="11" y="3" width="17" height="22" rx="5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M17.5 10.5v7l5.5-3.5-5.5-3.5Z" fill="currentColor" />
    </svg>
  );
}
