import type { Metadata } from "next";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "About Us",
  description: `Who builds ${config.app.name}, why it exists, and how to get in touch.`,
  alternates: { canonical: `${config.app.url}/about` },
};

type ContactLink = {
  label: string;
  value: string;
  href: string;
  external?: boolean;
};

const contacts: ContactLink[] = [
  { label: "Email", value: "zac@talysman.app", href: "mailto:zac@talysman.app" },
  {
    label: "LinkedIn",
    value: "zac-yauney",
    href: "https://www.linkedin.com/in/zac-yauney",
    external: true,
  },
  { label: "Twitter / X", value: "@yauneyz", href: "https://x.com/yauneyz", external: true },
  {
    label: "Discord",
    value: "Join our server",
    href: "https://discord.gg/QZzrM3gpt",
    external: true,
  },
];

export default function AboutPage() {
  return (
    <section className="about">
      <header className="about__header">
        <p className="section__eyebrow">About us</p>
        <h1 className="about__headline">
          Built by someone
          <br />
          who needed it.
        </h1>
      </header>

      <div className="about__body">
        <p className="about__lede">Hi, I&rsquo;m Zac, the creator of {config.app.name}.</p>
        <p>
          I&rsquo;ve always struggled with getting distracted. Brick (the phone app) really helped
          me with my phone, but as a programmer and entrepreneur I have the problem that all of my
          work lives on the computer, where the internet has a chance to distract me.
        </p>
        <p>
          I tried to install several desktop distraction blockers but they didn&rsquo;t work for me.
          I still wasn&rsquo;t focusing and getting work done.
        </p>
        <p>
          I got so desperate that I built a simple prototype &mdash; an app that only lets you
          unblock when a paired USB drive is inserted.
        </p>
        <p>It worked! I mean I still struggle, but a lot less than I did before.</p>
        <p>
          I thought that this was such a valuable tool that I would build it for real and send it
          out into the world. Hopefully it is helpful.
        </p>
      </div>

      <div className="about__contact">
        <h2>Get in touch</h2>
        <ul className="about__contact-list">
          {contacts.map((contact) => (
            <li key={contact.label}>
              <span className="about__contact-label">{contact.label}</span>
              <a
                href={contact.href}
                {...(contact.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              >
                {contact.value}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
