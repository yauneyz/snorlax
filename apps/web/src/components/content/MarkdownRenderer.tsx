type Props = { html: string; className?: string };

export function MarkdownRenderer({ html, className = "markdown" }: Props) {
  // Content is authored by us (files in /content), so it's trusted. If that
  // changes, switch the remark pipeline to `sanitize: true`.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
