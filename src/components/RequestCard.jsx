"use client";

import { useEffect, useState } from "react";
import AnalyticsCard from "@/components/AnalyticsCard";
import OrderStatusBadges from "@/components/OrderStatusBadges";
import ProgressBar from "@/components/ProgressBar.jsx";
import StatusBadge from "@/components/StatusBadge";
import { getItemRecommendedAction } from "@/lib/returnRequests";

const reasonLabels = {
  wrong_size: "Wrong size",
  damaged_item: "Damaged item",
  changed_mind: "Changed mind",
  late_delivery: "Late delivery",
  other: "Other",
};

function normalizeDashboardItem(item) {
  const returnReason = item.returnReason || "";
  const proofSrc =
    item.proofImage ||
    (item.imageUrl?.startsWith("data:") || item.imageUrl?.startsWith("http")
      ? item.imageUrl
      : "");

  return {
    id: item.id || item.itemId,
    title: item.title,
    sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    returnReason,
    comment: item.comment || "",
    selectedOption: item.selectedOption || "",
    proofImageName: item.proofImageName || "",
    proofImage: proofSrc,
    recommendedAction:
      item.recommendedAction || getItemRecommendedAction(returnReason),
  };
}

function getDisplayBestAction(request, items) {
  if (items.length === 0) {
    return request.bestAction || "Manual Review";
  }

  const recommendations = items.map((item) => item.recommendedAction);
  const unique = [...new Set(recommendations.filter(Boolean))];

  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return "Mixed Recommendations";
  return request.bestAction || "Manual Review";
}

function getSelectedItems(request) {
  const merged = new Map();

  for (const item of request.selectedItems || []) {
    const normalized = normalizeDashboardItem(item);
    merged.set(normalized.id, normalized);
  }

  for (const item of request.returnRequestItems || []) {
    const normalized = normalizeDashboardItem(item);
    const existing = merged.get(normalized.id) || {};
    merged.set(normalized.id, { ...existing, ...normalized });
  }

  return Array.from(merged.values());
}

export default function RequestCard({
  request,
  risk,
  isUpdating = false,
  actionError = "",
  emailFeedback = "",
  onApprove,
  onReject,
  onResolve,
  onManualReview,
  onNoteChange,
}) {
  const initials = request.email.slice(0, 2).toUpperCase();

  const [note, setNote] = useState(request.merchantNote || "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNote(request.merchantNote || "");
  }, [request.merchantNote]);

  async function runAction(callback) {
    if (isUpdating) return;
    setSaved(false);
    try {
      await callback();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Parent sets actionError
    }
  }

  function handleApprove() {
    runAction(() => onApprove(note));
  }

  function handleReject() {
    runAction(() => onReject(note));
  }

  function handleManualReview() {
    runAction(() => onManualReview(note));
  }

  function handleResolve() {
    runAction(() => onResolve(note));
  }

  function handleSaveNote() {
    runAction(() => onNoteChange(note));
  }

  const selectedItems = getSelectedItems(request);
  const displayBestAction = getDisplayBestAction(request, selectedItems);

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
              <p className="text-sm font-semibold text-slate-800">
                {request.email}
              </p>
              <OrderStatusBadges orderStatus={request.orderStatus} />
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedItems.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                    {selectedItems.length} selected item
                    {selectedItems.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                      {reasonLabels[request.reason] ?? request.reason}
                    </span>
                    {request.selectedOption && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-3 py-1">
                        {request.selectedOption}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <StatusBadge status={request.status} />
        </div>

        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Selected Return Items
          </p>

          {selectedItems.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
              No selected items recorded
            </p>
          ) : (
            <div className="space-y-3">
              {selectedItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-50 rounded-xl border border-slate-100 px-4 py-3 space-y-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      SKU: {item.sku} · Qty: {item.quantity} · $
                      {Number(item.price).toFixed(2)}
                    </p>
                  </div>

                  <div className="grid gap-1.5 text-xs text-slate-600 border-t border-slate-200 pt-2">
                    <p>
                      <span className="font-semibold text-slate-700">
                        Return reason:
                      </span>{" "}
                      {item.returnReason
                        ? (reasonLabels[item.returnReason] ?? item.returnReason)
                        : "Not provided"}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">
                        Customer note:
                      </span>{" "}
                      {item.comment || "No comment provided"}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">
                        Preferred resolution:
                      </span>{" "}
                      {item.selectedOption || "Not provided"}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">
                        AI recommended action:
                      </span>{" "}
                      <span className="inline-flex items-center rounded-full bg-slate-800 text-white px-2 py-0.5 text-[11px] font-semibold">
                        {item.recommendedAction}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">
                        Proof image:
                      </span>{" "}
                      {item.proofImageName || "No proof uploaded"}
                    </p>
                  </div>

                  {item.proofImage && (
                    <a
                      href={item.proofImage}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {/* biome-ignore lint/performance/noImgElement: User-uploaded proof image preview; Next Image remote config is not available yet. */}
                      <img
                        src={item.proofImage}
                        alt={`Proof for ${item.title}`}
                        className="w-full max-h-40 object-contain rounded-lg border border-slate-200 bg-white hover:opacity-90 transition-opacity"
                      />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!selectedItems.length && request.customerComment && (
          <div className="mb-5 bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Customer note
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">
              {request.customerComment}
            </p>
          </div>
        )}

        {!selectedItems.length && request.proofImage && (
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Proof Image
            </p>
            <a
              href={request.proofImage}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* biome-ignore lint/performance/noImgElement: User-uploaded proof image preview; Next Image remote config is not available yet. */}
              <img
                src={request.proofImage}
                alt="Customer proof"
                className="w-full max-h-56 object-contain rounded-xl border border-slate-200 bg-slate-50 hover:opacity-90 transition-opacity cursor-zoom-in"
              />
            </a>
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
            value={displayBestAction}
            valueClassName={`font-bold text-slate-900 leading-snug ${
              displayBestAction === "Mixed Recommendations"
                ? "text-sm"
                : "text-base"
            }`}
            subtitle={
              displayBestAction === "Mixed Recommendations"
                ? "See item-level recommendations below"
                : "AI recommended"
            }
            subtitleClassName="text-xs text-slate-400 mt-1"
          />
        </div>

        <div className="border-t border-slate-100 mb-4" />

        <div className="mb-4">
          <label
            htmlFor={`merchant-note-${request.id}`}
            className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2"
          >
            Merchant Note
          </label>
          <textarea
            id={`merchant-note-${request.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add an internal note about this request…"
            rows={2}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder-slate-400 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 resize-none"
          />
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={isUpdating}
            className="mt-2 text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {isUpdating ? "Saving…" : saved ? "✓ Saved" : "Save Note"}
          </button>
        </div>

        {actionError && (
          <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {actionError}
          </p>
        )}

        {emailFeedback === "success" && (
          <p className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            Customer email notification sent.
          </p>
        )}

        {emailFeedback === "warning" && (
          <p className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            Action saved, but email notification could not be sent.
          </p>
        )}

        <div className="flex gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleApprove}
            disabled={
              isUpdating ||
              request.status === "Approved" ||
              request.status === "Resolved"
            }
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            {isUpdating ? "Updating…" : "✓ Approve"}
          </button>

          <button
            type="button"
            onClick={handleReject}
            disabled={
              isUpdating ||
              request.status === "Needs Attention" ||
              request.status === "Resolved"
            }
            className="inline-flex items-center gap-2 border border-red-200 hover:border-red-300 hover:bg-red-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-red-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            {isUpdating ? "Updating…" : "✕ Reject"}
          </button>

          <button
            type="button"
            onClick={handleManualReview}
            disabled={
              isUpdating ||
              request.status === "Manual Review" ||
              request.status === "Resolved"
            }
            className="inline-flex items-center gap-2 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            {isUpdating ? "Updating…" : "👁 Manual Review"}
          </button>

          <button
            type="button"
            onClick={handleResolve}
            disabled={isUpdating || request.status === "Resolved"}
            className="inline-flex items-center gap-2 border border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-emerald-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all duration-150"
          >
            {isUpdating ? "Updating…" : "✅ Resolve"}
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
