// Scroll container with a pixel scrollbar (scroll_track / scroll_thumb sprites).
// The native scrollbar is hidden by CSS; wheel, touch and keyboard scrolling still work, and a
// scroll that reaches the end carries on into the page around it (no scroll traps on phones).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { chromeStyle } from './theme';

interface ScrollProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Keep the view pinned to the bottom while the user has not scrolled up (terminal mode). */
  stickToBottom?: boolean;
  /** No scrollbar and no gutter while there is nothing to scroll (panels with little room). */
  autoHide?: boolean;
  viewportRef?: Ref<HTMLDivElement>;
  /** Changes to this value re-run the stick-to-bottom check (e.g. a line count). */
  watch?: unknown;
}

const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

export function PixelScroll({ children, className, style, stickToBottom = false, autoHide = false, viewportRef, watch }: ScrollProps) {
  const vp = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // A finger, a mouse button or the scrollbar holds the view: new lines must not pull it away.
  const holding = useRef(false);
  const frame = useRef(0);
  const [m, setM] = useState({ top: 0, height: 1, client: 1 });
  const drag = useRef<{ startY: number; startTop: number } | null>(null);

  const measure = useCallback(() => {
    const el = vp.current;
    if (!el) return;
    const next = { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
    setM((cur) => (cur.top === next.top && cur.height === next.height && cur.client === next.client ? cur : next));
  }, []);

  /** Terminal mode: follow new content while the reader is at the bottom and not holding on. */
  const follow = useCallback(() => {
    const el = vp.current;
    if (el && stickToBottom && pinned.current && !holding.current) el.scrollTop = el.scrollHeight;
  }, [stickToBottom]);

  const release = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    follow();
  }, [follow]);

  const setViewport = useCallback(
    (el: HTMLDivElement | null) => {
      vp.current = el;
      if (typeof viewportRef === 'function') viewportRef(el);
      else if (viewportRef) (viewportRef as { current: HTMLDivElement | null }).current = el;
    },
    [viewportRef],
  );

  useLayoutEffect(() => {
    const el = vp.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      follow();
      measure();
    });
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [measure, follow]);

  useLayoutEffect(() => {
    follow();
    measure();
  }, [watch, follow, measure]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = () => {
    const el = vp.current;
    if (!el) return;
    pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
    // The thumb follows once per frame, however many scroll events arrive.
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        measure();
      });
    }
  };

  const scrollable = m.height > m.client + 1;
  const trackH = m.client;
  const thumbH = scrollable ? Math.max(24, Math.round((trackH * m.client) / m.height)) : trackH;
  const maxTop = Math.max(1, m.height - m.client);
  const thumbTop = scrollable ? Math.round(((trackH - thumbH) * m.top) / maxTop) : 0;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = vp.current;
      if (!d || !el) return;
      const ratio = (m.height - m.client) / Math.max(1, trackH - thumbH);
      el.scrollTop = d.startTop + (e.clientY - d.startY) * ratio;
    };
    const up = (e: PointerEvent) => {
      const dragged = drag.current !== null;
      drag.current = null;
      // A finger on the content lets go with touchend (its pointercancel only means the browser
      // started scrolling); the thumb and the mouse let go here.
      if (dragged || e.pointerType !== 'touch') release();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [m.height, m.client, trackH, thumbH, release]);

  return (
    <div className={`px-scroll ${autoHide ? 'px-scroll--auto' : ''} ${scrollable ? '' : 'is-idle'} ${className ?? ''}`} style={style}>
      <div
        className="px-scroll-viewport"
        ref={setViewport}
        onScroll={onScroll}
        tabIndex={0}
        onWheel={(e) => {
          if (e.deltaY < 0) pinned.current = false;
        }}
        onKeyDown={(e) => {
          if (UP_KEYS.has(e.key)) pinned.current = false;
        }}
        onTouchStart={() => {
          holding.current = true;
        }}
        onTouchEnd={release}
        onTouchCancel={release}
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch') holding.current = true;
        }}
      >
        <div ref={content}>{children}</div>
      </div>
      <div
        className="px-scroll-track"
        style={chromeStyle('scroll_track')}
        onPointerDown={(e) => {
          const el = vp.current;
          if (!el || e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const below = e.clientY - rect.top > thumbTop + thumbH / 2;
          if (!below) pinned.current = false;
          const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          el.scrollBy({ top: (below ? 1 : -1) * el.clientHeight * 0.9, behavior: smooth ? 'smooth' : 'auto' });
        }}
      >
        <div
          className="px-scroll-thumb"
          style={{ ...chromeStyle('scroll_thumb'), top: thumbTop, height: thumbH, position: 'absolute', left: -6, right: -6 }}
          onPointerDown={(e) => {
            e.preventDefault();
            holding.current = true;
            pinned.current = false;
            drag.current = { startY: e.clientY, startTop: vp.current?.scrollTop ?? 0 };
          }}
        />
      </div>
    </div>
  );
}
