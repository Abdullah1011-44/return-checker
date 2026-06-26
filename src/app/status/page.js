"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { readStatusPrefillFromSearchParams } from "@/lib/statusTrackingUrl";

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ReturnStatusContent() {
  const searchParams = useSearchParams();
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [returnData, setReturnData] = useState(null);

  useEffect(() => {
    const { orderNumber: order, email: prefillEmail } =
      readStatusPrefillFromSearchParams(searchParams);
    if (order) setOrderNumber(order);
    if (prefillEmail) setEmail(prefillEmail);
  }, [searchParams]);

  async function handleLookup(e) {
    e.preventDefault();
    setError("");
    setNotFound(false);
    setReturnData(null);
    setLoading(true);

    try {
      const res = await fetch("/api/return-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, email }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Something went wrong. Please try again.");
        return;
      }

      if (!data.found) {
        setNotFound(true);
        return;
      }

      setReturnData(data.return);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSearchAgain() {
    setReturnData(null);
    setNotFound(false);
    setError("");
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/80 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-8 py-6 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute -right-2 -bottom-8 w-16 h-16 rounded-full bg-white/5 pointer-events-none" />
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1 relative z-10">
              Return Recovery Copilot
            </p>
            <h1 className="text-white text-2xl font-bold tracking-tight relative z-10">
              {returnData ? "Your Return Status" : "Track Return Status"}
            </h1>
            {!returnData && (
              <p className="text-slate-300 text-sm mt-2 relative z-10 leading-relaxed">
                Exchange, return, or track an existing request.
              </p>
            )}
          </div>

          <div className="px-8 py-8">
            {!returnData && (
              <form onSubmit={handleLookup} className="space-y-5">
                <p className="text-sm text-slate-600 leading-relaxed">
                  Enter the order number and email you used when submitting your
                  return. We&apos;ll show the latest status from the merchant.
                </p>

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">
                    Order Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1001"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">
                    Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 disabled:opacity-50"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {error}
                  </p>
                )}

                {notFound && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    Return request not found.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm shadow-md shadow-slate-800/20"
                >
                  {loading
                    ? <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Looking up…
                      </>
                    : <>
                        Track Return Status{" "}
                        <span className="opacity-70">→</span>
                      </>}
                </button>
              </form>
            )}

            {returnData && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Order #{returnData.orderNumber}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5 truncate max-w-[220px]">
                      {returnData.email}
                    </p>
                  </div>
                  <StatusBadge status={returnData.status} />
                </div>

                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 shrink-0">Submitted</span>
                    <span className="font-semibold text-slate-800 text-right">
                      {formatDate(returnData.submittedAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 shrink-0">
                      Last updated
                    </span>
                    <span className="font-semibold text-slate-800 text-right">
                      {formatDate(returnData.updatedAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 shrink-0">
                      Merchant decision
                    </span>
                    <span className="font-semibold text-slate-800 text-right">
                      {returnData.merchantDecision}
                    </span>
                  </div>
                </div>

                {returnData.merchantNote
                  ? <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-blue-700 mb-2">
                        Message from merchant
                      </p>
                      <p className="text-sm text-blue-900 whitespace-pre-wrap leading-relaxed">
                        {returnData.merchantNote}
                      </p>
                    </div>
                  : <p className="text-xs text-slate-500 text-center">
                      No merchant note yet — check back after review.
                    </p>}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    Items in your return
                  </p>
                  <div className="space-y-3">
                    {returnData.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-200 bg-white p-4 text-sm space-y-1.5"
                      >
                        <p className="font-semibold text-slate-800">
                          {item.productName}
                        </p>
                        {item.sku && (
                          <p className="text-xs text-slate-500">
                            SKU: {item.sku}
                          </p>
                        )}
                        <p className="text-xs text-slate-600">
                          Reason: {item.returnReason}
                        </p>
                        <p className="text-xs text-slate-600">
                          Requested: {item.selectedOption}
                        </p>
                        <p className="text-xs text-slate-500">
                          Item decision: {item.merchantDecision}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSearchAgain}
                  className="w-full py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] text-slate-600 hover:text-slate-800 text-sm font-semibold transition-all duration-150"
                >
                  Look up another return
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          <Link
            href="/"
            className="underline hover:text-slate-600 transition-colors"
          >
            Start a new return
          </Link>
          {" · "}
          Need help?{" "}
          <a
            href="#"
            className="underline hover:text-slate-600 transition-colors"
          >
            Contact support
          </a>
        </p>
      </div>
    </main>
  );
}

export default function ReturnStatusPage() {
  return (
    <Suspense
      fallback={
        <main
          className="min-h-screen flex items-center justify-center px-4 py-12"
          style={{
            backgroundColor: "#f8fafc",
            backgroundImage:
              "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <p className="text-sm text-slate-500">Loading…</p>
        </main>
      }
    >
      <ReturnStatusContent />
    </Suspense>
  );
}
