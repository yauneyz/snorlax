export function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/><path d="M18 46V18h8v28h-8Zm16 0V18h12.5c5.8 0 9.5 3.2 9.5 8.1 0 2.8-1.4 5.1-3.9 6.4 3.2 1.1 5 3.6 5 6.7 0 4.5-3.5 6.8-9.6 6.8H34Zm8-17h4.1c1.6 0 2.6-.9 2.6-2.4s-1-2.3-2.6-2.3H42V29Zm0 10.7h5c1.8 0 2.8-.9 2.8-2.4 0-1.6-1-2.5-2.8-2.5h-5v4.9Z" fill="#F9FAFB"/></svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    },
  });
}
