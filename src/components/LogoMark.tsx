/**
 * The AccessLens mark: a lens whose glass is split dark and light, the contrast ratio the tool
 * measures. Decorative next to the "AccessLens" wordmark, so it is hidden from assistive
 * technology; the link text already names the site.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="38" y1="38" x2="56" y2="56" stroke="#0e5c6b" strokeWidth="9" strokeLinecap="round" />
      <circle cx="26" cy="26" r="16" fill="#ffffff" />
      <path d="M26 10A16 16 0 0 0 26 42Z" fill="#1a2230" />
      <circle cx="26" cy="26" r="19" fill="none" stroke="#1a2230" strokeWidth="6" />
    </svg>
  );
}
