import React from 'react';
import { Composition } from 'remotion';
import { FPS, HEIGHT, WIDTH, s } from './theme';
import { DEMOS } from './demos';
import { GALLERY, Gallery } from './Gallery';

export function Root() {
  return (
    <>
      {DEMOS.map((demo) => (
        <Composition
          key={demo.slug}
          id={demo.slug}
          component={demo.component}
          durationInFrames={s(demo.duration)}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          // Not used by the component: scripts/render.ts reads them back for the page's metadata.
          defaultProps={{ description: demo.description, poster: demo.poster }}
        />
      ))}
      <Composition id="gallery" component={Gallery} durationInFrames={GALLERY.length * FPS + 3 * FPS} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  );
}
