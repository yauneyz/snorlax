import React from 'react';
import { Composition, Still } from 'remotion';
import { FPS, HEIGHT, WIDTH, s } from './theme';
import { DEMOS } from './demos';
import { GALLERY, Gallery } from './Gallery';
import { PROMO_H, PROMO_W } from './promo/fx';
import { PROMO_HERO_SECONDS, PROMO_SHORT_SECONDS, PromoCover, PromoCoverVertical, PromoHero, PromoHeroVertical, PromoShort, VERTICAL_H } from './promo/Promo';

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
      {/* Feed promos, 4:5 (+ a 9:16 hero for short-form) — rendered by scripts/promo.ts, not the search-page pipeline. */}
      <Composition id="promo-hero" component={PromoHero} durationInFrames={s(PROMO_HERO_SECONDS)} fps={FPS} width={PROMO_W} height={PROMO_H} />
      <Composition id="promo-hero-vertical" component={PromoHeroVertical} durationInFrames={s(PROMO_HERO_SECONDS)} fps={FPS} width={PROMO_W} height={VERTICAL_H} />
      <Still id="promo-cover" component={PromoCover} width={PROMO_W} height={PROMO_H} />
      <Still id="promo-cover-vertical" component={PromoCoverVertical} width={PROMO_W} height={VERTICAL_H} />
      <Composition id="promo-short" component={PromoShort} durationInFrames={s(PROMO_SHORT_SECONDS)} fps={FPS} width={PROMO_W} height={PROMO_H} />
      <Composition id="gallery" component={Gallery} durationInFrames={GALLERY.length * FPS + 3 * FPS} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  );
}
