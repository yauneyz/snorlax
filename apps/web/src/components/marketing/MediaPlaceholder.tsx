import { config } from "@/lib/config";

/**
 * TEMPORARY: the artwork doesn't exist yet, so production ships without the slots entirely —
 * a labelled empty box reads as a broken page to a visitor. Development still renders them so
 * the shot list stays visible while the assets get produced. Delete this flag (and the
 * `--flat` layout variants it drives) once real media lands.
 */
export const showMediaPlaceholders = config.app.environment !== "production";

/**
 * Stand-in for artwork that doesn't exist yet.
 *
 * Every slot on the landing page that should eventually hold a video, screenshot, or photo
 * renders one of these instead: an outlined box held at the real asset's aspect ratio, labelled
 * with what belongs there. Sizing it correctly now means dropping the real file in later doesn't
 * move anything else on the page.
 *
 * Renders nothing in production while `showMediaPlaceholders` is false. Callers whose layout
 * depends on the box existing (a two-column grid, say) should branch on that flag themselves
 * rather than relying on this to disappear.
 */
type MediaPlaceholderProps = {
  /** What the finished asset is — shown large inside the box. */
  label: string;
  /** Width/height of the eventual asset, e.g. "16 / 9". Reserves the layout space. */
  ratio: string;
  /** Optional shot list or direction for whoever produces the asset. */
  note?: string;
  /** "video" | "screenshot" | "photo" — rendered as a small tag in the corner. */
  kind?: string;
  className?: string;
};

export function MediaPlaceholder({
  label,
  ratio,
  note,
  kind = "media",
  className,
}: MediaPlaceholderProps) {
  if (!showMediaPlaceholders) return null;

  return (
    <figure
      className={className ? `media-slot ${className}` : "media-slot"}
      style={{ aspectRatio: ratio }}
    >
      <span className="media-slot__kind">{kind}</span>
      <figcaption className="media-slot__body">
        <span className="media-slot__label">{label}</span>
        {note ? <span className="media-slot__note">{note}</span> : null}
        <span className="media-slot__ratio">{ratio.replace(/\s/g, "")}</span>
      </figcaption>
    </figure>
  );
}
