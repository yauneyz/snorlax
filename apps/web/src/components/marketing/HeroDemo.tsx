"use client";

import { useEffect, useRef } from "react";

/**
 * The hero demo: a silent, looping screen recording of the app being used, produced by
 * `pnpm capture:demo`.
 *
 * It autoplays because it carries the argument the headline makes — a session starts, a site
 * goes dark, and the off switch turns out to need a key that isn't in the room. There is no
 * audio and nothing in it is time-critical, so a viewer who never presses play misses nothing
 * the copy doesn't also say.
 *
 * Client component for one reason: `prefers-reduced-motion` can't stop an autoplaying video
 * from CSS, so a viewer who asked for less motion gets the poster frame and a control to start
 * it themselves.
 */
export function HeroDemo() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (!reduced.matches) return;
      element.pause();
      element.currentTime = 0;
      element.controls = true;
    };

    apply();
    reduced.addEventListener("change", apply);
    return () => reduced.removeEventListener("change", apply);
  }, []);

  return (
    <figure className="hero__media" id="demo">
      <video
        ref={video}
        className="hero__video"
        width={1920}
        height={1080}
        poster="/media/hero-demo-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Screen recording: a focus session starts, a blocked site is refused, and turning focus off asks for the USB key."
      >
        <source src="/media/hero-demo.webm" type="video/webm" />
        <source src="/media/hero-demo.mp4" type="video/mp4" />
      </video>
    </figure>
  );
}
