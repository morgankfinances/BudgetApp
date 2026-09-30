// src/components/CommentThread.jsx
// Comments on a transaction, shared with the household ("Is this the vet
// bill?"). Authors are stored by account ID and shown by name from the
// household's member list; someone who has left or deleted their account
// shows as "Former member". People can delete their own comments.

import React, { useState } from "react";
import { formatDateDisplay } from "../lib/utils.js";

export const COMMENT_MAX_LENGTH = 1000;

function whenLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const pad = (n) => String(n).padStart(2, "0");
  return `${formatDateDisplay(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)}, ${time}`;
}

export function authorLabel(authorId, currentUserId, members = []) {
  if (authorId && authorId === currentUserId) return "You";
  const member = members.find((m) => m.user_id === authorId);
  return member ? member.email : "Former member";
}

export function CommentThread({ t, currentUserId, members, onAdd, onDelete, onClose }) {
  const [draft, setDraft] = useState("");
  const comments = Array.isArray(t.comments) ? t.comments : [];
  const text = draft.trim();
  const add = () => {
    if (!text) return;
    onAdd(t.id, text.slice(0, COMMENT_MAX_LENGTH));
    setDraft("");
  };
  return (
    <div className="comment-thread" role="group" aria-label={`Comments on ${t.description || "this transaction"}`}>
      {comments.length ? (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <div className="comment-meta">
                <strong>{authorLabel(c.authorId, currentUserId, members)}</strong>
                <span className="hint">{whenLabel(c.at)}</span>
                {c.authorId && c.authorId === currentUserId && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onDelete(t.id, c.id)}
                    aria-label={`Delete your comment: ${c.text.slice(0, 40)}`}
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="comment-text">{c.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          No comments yet. Comments are shared with everyone in your household.
        </p>
      )}
      <label className="visually-hidden" htmlFor={`comment-${t.id}`}>
        Add a comment
      </label>
      <textarea
        id={`comment-${t.id}`}
        className="comment-input"
        rows={2}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder="Add a comment… (Ctrl+Enter to post)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            add();
          }
        }}
      />
      <div className="actions-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={!text}>
          Post comment
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
        {draft.length > COMMENT_MAX_LENGTH - 100 && (
          <span className="hint" aria-live="polite">
            {COMMENT_MAX_LENGTH - draft.length} characters left
          </span>
        )}
      </div>
    </div>
  );
}
