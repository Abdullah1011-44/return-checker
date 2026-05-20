"use client";
import { useEffect, useState } from "react";
import {
  saveReturnRequests,
  updateReturnRequestInStorage,
} from "@/lib/returnRequests";
import AnalyticsCard from "@/components/AnalyticsCard";
import StatusBadge from "@/components/StatusBadge";
import ProgressBar from "@/components/ProgressBar.jsx";
// ── Risk-level colour maps ────────────────────────────────────────
const riskConfig = {
  Low: {
    accentBar:  "bg-emerald-500",
    avatarBg:   "bg-emerald-50",
    avatarText: "text-emerald-700",
    scoreBar:   "bg-emerald-500",
    riskText:   "text-emerald-700",
    confidence: "High confidence",
  },
  Medium: {
    accentBar:  "bg-amber-500",
    avatarBg:   "bg-amber-50",
    avatarText: "text-amber-700",
    scoreBar:   "bg-amber-500",
    riskText:   "text-amber-700",
    confidence: "Moderate confidence",
  },
  High: {
    accentBar:  "bg-red-500",
    avatarBg:   "bg-red-50",
    avatarText: "text-red-700",
    scoreBar:   "bg-red-500",
    riskText:   "text-red-700",
    confidence: "Low confidence",
  },
};

const reasonLabels = {
  wrong_size:    "Wrong size",
  damaged_item:  "Damaged item",
  changed_mind:  "Changed mind",
  late_delivery: "Late delivery",
  other:         "Other",
};

// ── Return Card ───────────────────────────────────────────────────
function ReturnCard({ request, onUpdated }) {
  const risk     = riskConfig[request.riskLevel] ?? riskConfig["Medium"];
  const initials = request.email.slice(0, 2).toUpperCase();

  // Local state for the note textarea and save feedback
  const [note,    setNote]    = useState(request.merchantNote || "");
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  // ── Save merchant changes to localStorage ─────────────────────
  async function updateRequest(fields) {
    setSaving(true);
    setSaved(false);
    try {
      const updated = {
        ...request,
        ...fields,
        updatedAt: new Date().toISOString(),
      };
      updateReturnRequestInStorage(updated);
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      try {
        await fetch("/api/update-request", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: request.id, ...fields }),
        });
      } catch {
        // localStorage already updated
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Button handlers ────────────────────────────────────────────
  function handleApprove() {
    updateRequest({ status: "Approved", merchantDecision: "Approved" });
  }
  function handleManualReview() {
    updateRequest({ status: "Manual Review", merchantDecision: "Manual Review" });
  }
  function handleResolve() {
    updateRequest({ status: "Resolved", merchantDecision: "Resolved" });
  }
  function handleSaveNote() {
    updateRequest({ merchantNote: note });
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
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${risk.avatarBg} ${risk.avatarText}`}>
              {initials}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
                Order #{request.orderNumber}
              </p>
              <p className="text-sm font-semibold text-slate-800">
                {request.email}
              </p>
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

          {/* Status pill — updates live because request comes from parent state */}
          <StatusBadge status={request.status} />
        </div>

        {/* ── Customer comment ── */}
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
        {/* ── Proof image ── */}
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
    <p className="text-[11px] text-slate-400 mt-1">Click image to open full size</p>
  </div>
)}

        {/* ── Metrics row (AI score — merchant only) ── */}
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

        {/* ── Divider ── */}
        <div className="border-t border-slate-100 mb-4" />

        {/* ── Merchant note ── */}
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

        {/* ── Action buttons ── */}
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

        {/* Merchant decision line — only shows after a decision is made */}
        {request.merchantDecision && (
          <p className="mt-3 text-xs text-slate-400">
            Decision: <span className="font-semibold text-slate-600">{request.merchantDecision}</span>
            {request.updatedAt && (
              <> · {new Date(request.updatedAt).toLocaleString()}</>
            )}
          </p>
        )}

      </div>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────
export default function Dashboard() {
  const [requests, setRequests] = useState([]);

  const pendingCount   = requests.filter((r) => r.status === "Pending Review").length;
  const attentionCount = requests.filter((r) => r.status === "Needs Attention").length;

  useEffect(() => {
    try {
      const savedRequests = JSON.parse(
        localStorage.getItem("returnRequests") || "[]"
      );
      setRequests(Array.isArray(savedRequests) ? savedRequests : []);
    } catch {
      setRequests([]);
    }
  }, []);

  // ── When a card updates, replace that one request in state ─────
  // This makes the status badge update instantly without a page reload
  function handleRequestUpdated(updatedRequest) {
    setRequests((prev) => {
      const next = prev.map((r) =>
        r.id === updatedRequest.id ? updatedRequest : r
      );
      saveReturnRequests(next);
      return next;
    });
  }

  return (
    <main
      className="min-h-screen px-4 py-10"
      style={{
        backgroundColor: "#f8fafc",
        backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-3xl mx-auto">

        {/* ── Header ── */}
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Return Recovery Copilot
            </p>
            <h1 className="text-2xl font-bold text-slate-900">
              Merchant Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Review return requests and AI recovery insights
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <a
              href="/analytics"
              className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-full px-4 py-2 shadow-sm transition-all duration-150"
            >
              View Analytics
            </a>
            <span className="text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
              {requests.length} requests
            </span>
            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
              {pendingCount} pending
            </span>
            <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-3 py-1">
             {attentionCount} needs attention
            </span>
          </div>
        </div>

        {/* ── Empty state ── */}
        {requests.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm font-medium">No return requests yet.</p>
            <p className="text-xs mt-1">Submitted requests will appear here.</p>
          </div>
        )}

        {/* ── Cards ── */}
        <div className="space-y-4">
          {requests.map((request) => (
            <ReturnCard
              key={request.id}
              request={request}
              onUpdated={handleRequestUpdated}
            />
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          Powered by Return Recovery Copilot ·{" "}
          <a href="#" className="underline hover:text-slate-600 transition-colors">
            View documentation
          </a>
        </p>
      </div>
    </main>
  );
}