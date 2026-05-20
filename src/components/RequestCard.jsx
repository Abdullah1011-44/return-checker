"use client";

import { useState } from "react";
import AnalyticsCard from "@/components/AnalyticsCard";
import StatusBadge from "@/components/StatusBadge";
import ProgressBar from "@/components/ProgressBar.jsx";

const reasonLabels = {
  wrong_size: "Wrong size",
  damaged_item: "Damaged item",
  changed_mind: "Changed mind",
  late_delivery: "Late delivery",
  other: "Other",
};

export default function RequestCard({
  request,
  risk,
  onApprove,
  onResolve,
  onManualReview,
  onNoteChange,
}) {
  const initials = request.email.slice(0, 2).toUpperCase();

  const [note, setNote] = useState(request.merchantNote || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function runAction(action) {
    setSaving(true);
    setSaved(false);
    try {
      await action();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleApprove() {
    runAction(() => onApprove());
  }

  function handleManualReview() {
    runAction(() => onManualReview());
  }

  function handleResolve() {
    runAction(() => onResolve());
  }

  function handleSaveNote() {
    runAction(() => onNoteChange(note));
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">

      {/* Colour accent bar */}
      <div className={`h-1 w-full ${risk.accentBar}`} />

      <div className="p-6">

        {/* ── Top row ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div className="flex items-start gap-3">

            {/* Avatar */}
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${risk.avatarBg} ${risk.avatarText}`}
            >
              {initials}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
                Order #{request.orderNumber}
              </p>
              <p className="text-sm font-semibold text-slate-800">{request.email}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                  {reasonLabels[request.reason] ?? request.reason}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                  {request.selectedOption}
                </span>
              </div>
            </div>
          </div>

          <StatusBadge status={request.status} />
        </div>

        {request.customerComment && (
          <div className="mb-5 bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Customer note
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              {request.customerComment}
            </p>
          </div>
        )}

        {request.proofImage && (
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Proof Image
            </p>
            <a href={request.proofImage} target="_blank" rel="noopener noreferrer">
              <img
                src={request.proofImage}
                alt="Customer proof"
                className="w-full max-h-56 object-contain rounded-xl border border-slate-200 bg-slate-50 hover:opacity-90 transition-opacity cursor-zoom-in"
              />
            </a>
            <p className="text-[11px] text-slate-400 mt-1">
              Click image to open full size
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-slate-50 rounded-xl p-3.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              AI Score
            </p>
            <p className="text-2xl font-bold text-slate-900 leading-none">
              {request.recoveryScore}%
            </p>
            <div className="mt-2">
              <ProgressBar
                percent={request.recoveryScore}
                barColorClass={risk.scoreBar}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">{risk.confidence}</p>
          </div>

          <AnalyticsCard
            label="Risk Level"
            value={request.riskLevel}
            valueClassName={`text-2xl font-bold leading-none ${risk.riskText}`}
            subtitle={
              request.riskLevel === "Low"
                ? "Minimal churn risk"
                : request.riskLevel === "Medium"
                  ? "Watch closely"
                  : request.riskLevel === "High"
                    ? "Escalate quickly"
                    : ""
            }
          />

          <AnalyticsCard
            label="Best Action"
            value={request.bestAction}
            valueClassName="text-base font-bold text-slate-900 leading-snug"
            subtitle="AI recommended"
            subtitleClassName="text-xs text-slate-400 mt-1"
          />
        </div>

        <div className="border-t border-slate-100 mb-4" />

        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            Merchant Note
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add an internal note about this request…"
            rows={2}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder-slate-400 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 resize-none"
          />
          <button
            onClick={handleSaveNote}
            disabled={saving}
            className="mt-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Note"}
          </button>
        </div>

        <div className="flex gap-2.5 flex-wrap">
          <button
            onClick={handleApprove}
            disabled={request.status === "Approved"}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            ✓ Approve
          </button>

          <button
            onClick={handleManualReview}
            disabled={request.status === "Manual Review"}
            className="inline-flex items-center gap-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            👁 Manual Review
          </button>

          <button
            onClick={handleResolve}
            disabled={request.status === "Resolved"}
            className="inline-flex items-center gap-2 border border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-emerald-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            ✅ Resolve
          </button>
        </div>

        {request.merchantDecision && (
          <p className="mt-3 text-xs text-slate-400">
            Decision:{" "}
            <span className="font-semibold text-slate-600">
              {request.merchantDecision}
            </span>
            {request.updatedAt && (
              <> · {new Date(request.updatedAt).toLocaleString()}</>
            )}
          </p>
        )}

      </div>
    </div>
  );
}
