import React, { useEffect, useRef, useState } from "react";
import { ThemedStar } from "../householdGate.jsx";

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

export function StatBlock({ value, label }) {
  return (
    <div className="summary-stat">
      <div className="num">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}


// Wraps a wide table with a scrollbar at both the top and the bottom of
// the panel, kept in sync — so a long table doesn't force scrolling all
// the way down just to find the way to scroll sideways.
export function DualScrollPanel({ children }) {
  const topRef = useRef(null);
  const bottomRef = useRef(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncSource = useRef(null);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const update = () => setScrollWidth(el.scrollWidth);
    update();
    // Observe the actual table (the scrollable content), not the
    // container — the container's own box size doesn't change just
    // because a column was added to what's inside it.
    const target = el.firstElementChild || el;
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  function handleTopScroll() {
    if (syncSource.current === "bottom") {
      syncSource.current = null;
      return;
    }
    syncSource.current = "top";
    if (bottomRef.current && topRef.current) bottomRef.current.scrollLeft = topRef.current.scrollLeft;
  }

  function handleBottomScroll() {
    if (syncSource.current === "top") {
      syncSource.current = null;
      return;
    }
    syncSource.current = "bottom";
    if (topRef.current && bottomRef.current) topRef.current.scrollLeft = bottomRef.current.scrollLeft;
  }

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div ref={topRef} onScroll={handleTopScroll} className="dual-scroll-top">
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>
      <div ref={bottomRef} onScroll={handleBottomScroll} style={{ overflowX: "auto" }}>
        {children}
      </div>
    </div>
  );
}


export function EmptyState({ title, body, ctaLabel, onCta }) {
  return (
    <div className="empty-state">
      <div>
        <ThemedStar className="empty-state-star" />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {ctaLabel && (
        <button className="btn btn-primary" onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
