import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TUTORIAL_STEPS } from "../lib/tutorial.js";

export function TutorialDialog({ step, onBack, onNext, onSkip, onFinish, onUpload, showUpload }) {
  const s = TUTORIAL_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TUTORIAL_STEPS.length - 1;
  const nextRef = useRef(null);

  // Keyboard: Escape skips; focus lands on the main button each step.
  useEffect(() => {
    nextRef.current?.focus();
  }, [step]);
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onSkip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  // Drawn at the top level of the page (a React "portal"), outside the
  // app's own layer, so it sits in front of everything, including the
  // Settings button, which lives outside the app in householdGate.jsx.
  return createPortal(
    <div className="tutorial-scrim">
      <div className="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <div className="tutorial-top">
          <span className="tutorial-count">
            Step {step + 1} of {TUTORIAL_STEPS.length}
          </span>
          {!isLast && (
            <button type="button" className="tutorial-skip" onClick={onSkip}>
              Skip tour
            </button>
          )}
        </div>
        <div className="tutorial-progress">
          <div className="tutorial-progress-fill" style={{ width: `${((step + 1) / TUTORIAL_STEPS.length) * 100}%` }} />
        </div>
        <h2 id="tutorial-title" className="tutorial-title">
          {s.title}
        </h2>
        <p className="tutorial-body">{s.body}</p>
        <div className="tutorial-actions">
          {!isFirst && (
            <button type="button" className="tutorial-btn tutorial-btn-secondary" onClick={onBack}>
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {isLast ? (
            <>
              {showUpload && (
                <button type="button" className="tutorial-btn tutorial-btn-secondary" onClick={onUpload}>
                  Upload a statement
                </button>
              )}
              <button ref={nextRef} type="button" className="tutorial-btn tutorial-btn-primary" onClick={onFinish}>
                Finish
              </button>
            </>
          ) : (
            <button ref={nextRef} type="button" className="tutorial-btn tutorial-btn-primary" onClick={onNext}>
              {isFirst ? "Start the tour" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
