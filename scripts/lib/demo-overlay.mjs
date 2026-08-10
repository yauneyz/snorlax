/**
 * The on-screen furniture for the demo recording: a synthetic pointer and a caption line.
 *
 * A screen recording of a scripted app has no cursor — Playwright drives the renderer directly
 * and wf-recorder doesn't composite one — so a viewer sees buttons activate with nothing
 * touching them. This draws the pointer the automation is standing in for, and captions the
 * beat, using the app's own type so the overlay reads as part of the product rather than
 * something bolted on in an editor.
 *
 * Injected into the page after seeding; everything lives under one root element and is marked
 * `pointer-events: none`, so it can't intercept the clicks the script is making.
 */
export const OVERLAY_SOURCE = `
(() => {
  const root = document.createElement('div');
  root.id = 'demo-overlay';
  root.innerHTML = \`
    <style>
      #demo-overlay, #demo-overlay * { pointer-events: none; }
      #demo-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        font-family: 'Space Grotesk Variable', ui-sans-serif, system-ui, sans-serif;
      }
      #demo-cursor {
        position: absolute;
        top: 0;
        left: 0;
        width: 26px;
        height: 26px;
        transform: translate(-100px, -100px);
        transition: transform 700ms cubic-bezier(0.33, 0, 0.15, 1);
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.65));
        opacity: 0;
      }
      #demo-cursor.on { opacity: 1; }
      #demo-ring {
        position: absolute;
        top: 0;
        left: 0;
        width: 46px;
        height: 46px;
        margin: -23px 0 0 -23px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.85);
        opacity: 0;
      }
      #demo-ring.pulse { animation: demo-pulse 520ms ease-out; }
      @keyframes demo-pulse {
        0%   { opacity: 0.9; transform: scale(0.35); }
        100% { opacity: 0;   transform: scale(1.25); }
      }
      #demo-caption {
        position: absolute;
        left: 50%;
        bottom: 46px;
        transform: translate(-50%, 14px);
        padding: 13px 26px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.11);
        background: rgba(10, 11, 13, 0.82);
        backdrop-filter: blur(14px);
        color: #eef0f3;
        font-size: 21px;
        font-weight: 500;
        letter-spacing: 0.005em;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 420ms ease, transform 420ms ease;
      }
      #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
    </style>
    <svg id="demo-cursor" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2.2 L4 20.4 L8.7 16.1 L11.9 23.2 L15.1 21.7 L12 14.8 L18.4 14.6 Z"
            fill="#ffffff" stroke="#0b0c0e" stroke-width="1.3" stroke-linejoin="round" />
    </svg>
    <div id="demo-ring"></div>
    <div id="demo-caption"></div>
  \`;
  document.body.appendChild(root);

  const cursor = root.querySelector('#demo-cursor');
  const ring = root.querySelector('#demo-ring');
  const caption = root.querySelector('#demo-caption');

  window.__demo = {
    /** Glide the pointer to a viewport point. Duration is set per move so travel reads evenly. */
    moveTo(x, y, ms = 700) {
      cursor.classList.add('on');
      cursor.style.transitionDuration = ms + 'ms';
      // The hotspot is the arrow's tip, not its box corner.
      cursor.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)';
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    },
    click() {
      ring.classList.remove('pulse');
      void ring.offsetWidth; // restart the animation
      ring.classList.add('pulse');
    },
    hideCursor() {
      cursor.classList.remove('on');
    },
    say(text) {
      caption.textContent = text;
      caption.classList.add('on');
    },
    hush() {
      caption.classList.remove('on');
    },
  };
})();
`;
