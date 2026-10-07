"use client";

import { useEffect, useRef } from "react";

/**
 * A search page's demo: a silent, looping motion graphic built from the real desktop UI
 * (apps/motion). Like the hero demo it autoplays because it carries the page's argument, and
 * every beat in it is also written out beside it, so nothing is lost with it paused.
 *
 * A viewer who asked for less motion gets the poster frame and controls instead.
 */
export function DemoVideo({ slug, label }: { slug: string; label: string }) {
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
    <video
      ref={video}
      className="intent-demo__video"
      width={1920}
      height={1080}
      poster={`/media/demos/${slug}.jpg`}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
    >
      <source src={`/media/demos/${slug}.webm`} type="video/webm" />
      <source src={`/media/demos/${slug}.mp4`} type="video/mp4" />
    </video>
  );
}
