"use client";
import { useEffect, useState } from "react";
import {
  saveReturnRequests,
  updateReturnRequestInStorage,
} from "@/lib/returnRequests";
import RequestCard from "@/components/RequestCard";

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

  function handleRequestUpdated(updatedRequest) {
    setRequests((prev) => {
      const next = prev.map((r) =>
        r.id === updatedRequest.id ? updatedRequest : r
      );
      saveReturnRequests(next);
      return next;
    });
  }

  async function updateRequest(request, fields) {
    const updated = {
      ...request,
      ...fields,
      updatedAt: new Date().toISOString(),
    };
    updateReturnRequestInStorage(updated);
    handleRequestUpdated(updated);

    try {
      await fetch("/api/update-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, ...fields }),
      });
    } catch {
      // localStorage already updated
    }
  }

  function handleApprove(request) {
    return () =>
      updateRequest(request, {
        status: "Approved",
        merchantDecision: "Approved",
      });
  }

  function handleManualReview(request) {
    return () =>
      updateRequest(request, {
        status: "Manual Review",
        merchantDecision: "Manual Review",
      });
  }

  function handleResolve(request) {
    return () =>
      updateRequest(request, {
        status: "Resolved",
        merchantDecision: "Resolved",
      });
  }

  function handleNoteChange(request) {
    return (note) => updateRequest(request, { merchantNote: note });
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

        {requests.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm font-medium">No return requests yet.</p>
            <p className="text-xs mt-1">Submitted requests will appear here.</p>
          </div>
        )}

        <div className="space-y-4">
          {requests.map((request) => {
            const risk =
              riskConfig[request.riskLevel] ?? riskConfig["Medium"];

            return (
              <RequestCard
                key={request.id}
                request={request}
                risk={risk}
                onApprove={handleApprove(request)}
                onManualReview={handleManualReview(request)}
                onResolve={handleResolve(request)}
                onNoteChange={handleNoteChange(request)}
              />
            );
          })}
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
