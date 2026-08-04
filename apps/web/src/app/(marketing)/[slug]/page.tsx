import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FREE_BLOCKED_SITE_LIMIT, PRO_TRIAL_DAYS } from "@talysman/product";
import {
  MediaPlaceholder,
  showMediaPlaceholders,
} from "@/components/marketing/MediaPlaceholder";
import {
  getIntentPage,
  intentPages,
  relatedIntentPages,
  type IntentSection,
} from "@/lib/content/intent";
import { config } from "@/lib/config";

/**
 * One template for the high-intent search pages. They live at the site root — the query is the
 * URL — and static segments still win over this one, so `/pricing` and `/download` are unaffected.
 * Anything not in the registry 404s.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return intentPages.map((page) => ({ slug: page.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getIntentPage(slug);
  if (!page) return { title: "Not found" };

  const url = `${config.app.url}/${page.slug}`;
  return {
    // Absolute: these titles are written whole, so the root layout's brand suffix would
    // push them past what a result page will show.
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title: page.metaTitle,
      description: page.metaDescription,
      url,
      images: ["/og-default.png"],
    },
  };
}

function Section({ section }: { section: IntentSection }) {
  switch (section.kind) {
    case "prose":
      return (
        <section className="section intent-prose" id={section.id}>
          <h2 className="section__title">{section.title}</h2>
          {section.lede ? <p className="section__lede">{section.lede}</p> : null}
          <div className="intent-prose__body">{section.body}</div>
        </section>
      );

    case "demo": {
      // Until the footage exists the beats are the demonstration, so production drops the
      // second column entirely rather than leaving a gap beside them.
      const outcome = section.outcome ? (
        <div className="intent-demo__outcome">{section.outcome}</div>
      ) : null;

      return (
        <section className="section intent-demo" id={section.id ?? "demo"}>
          <h2 className="section__title">{section.title}</h2>
          {section.lede ? <p className="section__lede">{section.lede}</p> : null}
          <div
            className={
              showMediaPlaceholders
                ? "intent-demo__grid"
                : "intent-demo__grid intent-demo__grid--flat"
            }
          >
            <ol className="beats">
              {section.beats.map((beat) => (
                <li key={beat.label} className="beat">
                  <span className="beat__label">{beat.label}</span>
                  <p className="beat__body">{beat.body}</p>
                </li>
              ))}
            </ol>
            {showMediaPlaceholders ? (
              <div className="intent-demo__aside">
                <MediaPlaceholder
                  ratio={section.media.ratio}
                  kind={section.media.kind}
                  label={section.media.label}
                  note={section.media.note}
                />
                {outcome}
              </div>
            ) : (
              outcome
            )}
          </div>
        </section>
      );
    }

    case "table":
      return (
        <section className="section intent-table" id={section.id}>
          <h2 className="section__title">{section.title}</h2>
          {section.lede ? <p className="section__lede">{section.lede}</p> : null}
          {/* Wide tables scroll inside this box rather than pushing the page sideways. */}
          <div className="intent-table__scroll">
            <table className="compare">
              {section.caption ? (
                <caption className="compare__caption">{section.caption}</caption>
              ) : null}
              <thead>
                <tr>
                  {section.columns.map((column, index) => (
                    <th
                      key={column || `col-${index}`}
                      scope="col"
                      className={
                        section.highlightLast && index === section.columns.length - 1
                          ? "compare__cell--ours"
                          : undefined
                      }
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, index) =>
                      index === 0 ? (
                        <th key={index} scope="row">
                          {cell}
                        </th>
                      ) : (
                        <td
                          key={index}
                          className={
                            section.highlightLast && index === row.length - 1
                              ? "compare__cell--ours"
                              : undefined
                          }
                        >
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {section.footnote ? (
            <p className="intent-table__footnote">{section.footnote}</p>
          ) : null}
        </section>
      );

    case "steps":
      return (
        <section className="section" id={section.id}>
          <h2 className="section__title">{section.title}</h2>
          {section.lede ? <p className="section__lede">{section.lede}</p> : null}
          <ol className="steps">
            {section.steps.map((step, index) => (
              <li key={step.title} className="step">
                <span className="step__number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      );

    case "cards":
      return (
        <section className="section" id={section.id}>
          <h2 className="section__title">{section.title}</h2>
          {section.lede ? <p className="section__lede">{section.lede}</p> : null}
          <ul className="outcomes">
            {section.cards.map((card) => (
              <li key={card.title} className="outcome">
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </li>
            ))}
          </ul>
        </section>
      );

    case "honesty":
      return (
        <section className="section intent-honesty" id={section.id}>
          <h2 className="section__title">{section.title}</h2>
          <div className="intent-honesty__body">{section.body}</div>
        </section>
      );

    case "faq":
      return (
        <section className="section faq" id={section.id ?? "faq"}>
          <h2 className="section__title">{section.title ?? "Frequently asked questions"}</h2>
          <div className="faq__list">
            {section.items.map((item) => (
              <details key={item.q} className="faq__item">
                <summary>{item.q}</summary>
                <div className="faq__answer">{item.a}</div>
              </details>
            ))}
          </div>
        </section>
      );
  }
}

export default async function IntentLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getIntentPage(slug);
  if (!page) notFound();

  const related = relatedIntentPages(page);

  // A plain <div>, not an <article>: `.marketing-main article` carries the rendered-markdown
  // typography for the blog, and inheriting it here would restyle the CTAs and cards.
  return (
    <div className="intent">
      <header className="intent__hero">
        <p className="intent__eyebrow">{page.eyebrow}</p>
        <h1 className="intent__title">{page.title}</h1>
        <div className="intent__lede">{page.lede}</div>
        <div className="intent__ctas">
          <Link href="/download" className="landing__cta landing__cta--primary">
            Start focusing free
          </Link>
          <a href="#demo" className="landing__cta landing__cta--secondary">
            See how it works
          </a>
        </div>
        <p className="intent__trial">
          Free forever for {FREE_BLOCKED_SITE_LIMIT} sites · or try{" "}
          <Link href="/pricing">Pro free for {PRO_TRIAL_DAYS} days</Link>
        </p>
      </header>

      {/* The intent, answered before anything is sold. Someone who leaves after ten
          seconds should still leave with the answer they came for. */}
      <section className="intent__answer">
        <p className="intent__answer-eyebrow">The short answer</p>
        <div className="intent__answer-body">{page.answer}</div>
      </section>

      {page.sections.map((section, index) => (
        <Section key={`${section.kind}-${index}`} section={section} />
      ))}

      <section className="cta-band">
        <h2>{page.cta?.heading ?? "Make your next session one you actually finish"}</h2>
        <p>
          {page.cta?.body ??
            "Pair a key, put it somewhere inconvenient, and get back to work."}
        </p>
        <Link href="/download" className="landing__cta landing__cta--primary">
          Start focusing free
        </Link>
        <p className="cta-band__note">
          Free forever, no card. Want schedules and app blocking?{" "}
          <Link href="/pricing">Try Pro free for {PRO_TRIAL_DAYS} days</Link>.
        </p>
      </section>

      {related.length > 0 ? (
        <nav className="intent__related" aria-label="Related pages">
          <h2 className="intent__related-title">Keep reading</h2>
          <ul>
            {related.map((other) => (
              <li key={other.slug}>
                <Link href={`/${other.slug}`}>
                  <span className="intent__related-name">{other.title}</span>
                  <span className="intent__related-hint">{other.eyebrow}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
