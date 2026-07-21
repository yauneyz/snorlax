/**
 * The Talysman logo mark, inlined so it stays crisp at header sizes and inherits no network cost.
 *
 * Source of truth: assets/brand/source/talysman-mark.svg. The gradient/mask ids are prefixed
 * because a page may render the mark more than once and SVG ids are document-global.
 * apps/web/src/components/brand/TalysmanMark.tsx is the same drawing for the web app.
 */
export function TalysmanMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="Talysman"
      className={className}
    >
      <defs>
        <linearGradient id="tal-mark-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f3f5" />
          <stop offset="0.48" stopColor="#c7ccd4" />
          <stop offset="1" stopColor="#8b9098" />
        </linearGradient>
        <mask id="tal-mark-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <g fill="#fff">
            <path d="M160 90 L256 34 L352 90 L326 105 L256 64 L186 105 Z" />
            <path d="M76 108 L226 149 L226 181 L111 150 L111 193 L151 213 L133 242 L76 213 Z" />
            <path d="M126 164 L197 183 L197 222 L171 211 L171 201 L126 188 Z" />
            <path d="M76 234 L111 252 L111 304 L200 346 L200 379 L76 322 Z" />
            <path d="M126 264 L171 284 L171 316 L126 294 Z" />
            <path d="M78 343 L200 399 L200 433 L112 383 Z" />
            <g transform="translate(512 0) scale(-1 1)">
              <path d="M76 108 L226 149 L226 181 L111 150 L111 193 L151 213 L133 242 L76 213 Z" />
              <path d="M126 164 L197 183 L197 222 L171 211 L171 201 L126 188 Z" />
              <path d="M76 234 L111 252 L111 304 L200 346 L200 379 L76 322 Z" />
              <path d="M126 264 L171 284 L171 316 L126 294 Z" />
              <path d="M78 343 L200 399 L200 433 L112 383 Z" />
            </g>
            <path d="M201 140 H311 V174 H276 V329 H302 V428 L256 463 L210 428 V329 H236 V174 H201 Z" />
          </g>
          <g fill="#000">
            <path d="M256 232 L273 249 L256 266 L239 249 Z" />
            <rect x="249" y="263" width="14" height="53" rx="4" />
            <rect x="229" y="367" width="18" height="22" rx="2" />
            <rect x="265" y="367" width="18" height="22" rx="2" />
          </g>
        </mask>
      </defs>
      <rect width="512" height="512" fill="url(#tal-mark-silver)" mask="url(#tal-mark-mask)" />
    </svg>
  );
}
