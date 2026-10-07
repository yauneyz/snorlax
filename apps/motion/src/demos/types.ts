import type React from 'react';

export type Demo = {
  /** The search page this is the demo for; also the composition id and output file name. */
  slug: string;
  component: React.FC;
  /** Seconds. */
  duration: number;
  /** One sentence for the page's VideoObject and the <video> label: what happens on screen. */
  description: string;
  /** Seconds into the video for the poster frame — the moment that carries the idea. */
  poster: number;
};
