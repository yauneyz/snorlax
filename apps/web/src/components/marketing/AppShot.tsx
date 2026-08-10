import Image from "next/image";

/**
 * A screenshot of the desktop app, framed to match the slot it sits in.
 *
 * The captures come out of `pnpm capture:marketing`, which drives the real Electron UI against
 * the mock service — so these are photographs of the product rather than mockups, and they are
 * re-shot rather than retouched when the UI changes.
 *
 * Intrinsic dimensions are passed so the browser reserves the space before the image arrives;
 * the aspect ratios match the slots the placeholders used to hold (4:3 for the steps, 3:2 for
 * the diagnosis) so nothing on the page moves.
 */
type AppShotProps = {
  src: string;
  /** What the screenshot shows, for a reader who can't see it. Not a caption. */
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Set on above-the-fold shots so Next preloads rather than lazy-loads them. */
  priority?: boolean;
  sizes?: string;
};

export function AppShot({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
  sizes = "(max-width: 900px) 100vw, 33vw",
}: AppShotProps) {
  return (
    <figure className={className ? `app-shot ${className}` : "app-shot"}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        className="app-shot__image"
      />
    </figure>
  );
}
