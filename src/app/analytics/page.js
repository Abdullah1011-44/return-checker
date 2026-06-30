"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMerchantJson, getApiErrorMessage } from "@/lib/dashboardFetch";

// Human-readable labels for return reason codes
const reasonLabels = {
  wrong_size: "Wrong size",
  damaged_item: "Damaged item",
  changed_mind: "Changed mind",
  late_delivery: "Late delivery",
  other: "Other",
};

const ALL_REASONS = [
  "wrong_size",
  "damaged_item",
  "changed_mind",
  "late_delivery",
  "other",
];

const ALL_OPTIONS = [
  "Exchange Product",
  "Store Credit",
  "Partial Refund",
  "Manual Review",
];

/** Resolve Prisma ReturnStatus from API payload (rawStatus preferred) */
function getPrismaStatus(request) {
  if (request.rawStatus) return request.rawStatus;

  const uiToPrisma = {
    "Pending Review": "PENDING",
    "Manual Review": "IN_REVIEW",
    Approved: "APPROVED",
    "Needs Attention": "REJECTED",
    Resolved: "RESOLVED",
  };
  return uiToPrisma[request.status] ?? request.status;
}

function countByPrismaStatus(requests, ...statuses) {
  const set = new Set(statuses);
  let count = 0;
  for (const request of requests) {
    if (set.has(getPrismaStatus(request))) count++;
  }
  return count;
}

// Count requests that match a field value (e.g. riskLevel === "High")
function countByField(requests, field, value) {
  let count = 0;
  for (const request of requests) {
    if (request[field] === value) count++;
  }
  return count;
}

// Find the value that appears most often (e.g. most common reason)
function getMostCommon(requests, field) {
  const counts = {};

  for (const request of requests) {
    const key = request[field];
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }

  let topKey = null;
  let topCount = 0;

  for (const key in counts) {
    if (counts[key] > topCount) {
      topKey = key;
      topCount = counts[key];
    }
  }

  return { key: topKey, count: topCount };
}

// Pick the risk level with the most requests (High wins ties)
function getTopRiskCategory(requests) {
  const levels = ["High", "Medium", "Low"];
  const counts = { High: 0, Medium: 0, Low: 0 };

  for (const request of requests) {
    if (counts[request.riskLevel] !== undefined) {
      counts[request.riskLevel]++;
    }
  }

  let topLevel = null;
  let topCount = -1;

  for (const level of levels) {
    if (counts[level] > topCount) {
      topLevel = level;
      topCount = counts[level];
    }
  }

  return { key: topCount > 0 ? topLevel : null, count: topCount };
}

// Build { label, count } rows for a breakdown chart
function buildBreakdown(requests, field, labelsMap, allKeys) {
  const counts = {};
  for (const key of allKeys) {
    counts[key] = 0;
  }

  for (const request of requests) {
    const key = request[field];
    if (key in counts) {
      counts[key]++;
    } else if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return allKeys.map((key) => ({
    key,
    label: labelsMap?.[key] ?? key,
    count: counts[key] || 0,
  }));
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
        {label}
      </p>
      <p
        className={`text-3xl font-bold leading-none ${accent ?? "text-slate-900"}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-2">{sub}</p>}
    </div>
  );
}

function InsightCard({ label, value, detail }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
        {label}
      </p>
      <p className="text-lg font-bold text-slate-900 leading-snug">{value}</p>
      {detail && <p className="text-xs text-slate-500 mt-2">{detail}</p>}
    </div>
  );
}

function BreakdownRow({ label, count, total }) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700 truncate">{label}</span>
        <span className="text-slate-500 whitespace-nowrap shrink-0">
          {count} <span className="text-slate-400">({percent}%)</span>
        </span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-slate-800 rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const { res, data, aborted } = await fetchMerchantJson("/api/requests");

      if (aborted) {
        setLoadError("Could not load analytics.");
        setRequests([]);
        return;
      }

      if (!res?.ok || data?.success !== true) {
        setLoadError(
          getApiErrorMessage(res, data, "Could not load analytics."),
        );
        setRequests([]);
        return;
      }

      const nextRequests = Array.isArray(data.requests) ? data.requests : [];
      setRequests(nextRequests);
      setLoadError("");
    } catch (error) {
      console.error("[analytics] Failed to load analytics data.", {
        name: error instanceof Error ? error.name : "Error",
      });
      setLoadError("Could not load analytics.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const total = requests.length;
  const hasData = total > 0;

  const approved = countByPrismaStatus(requests, "APPROVED");
  const pending = countByPrismaStatus(requests, "PENDING", "IN_REVIEW");
  const resolved = countByPrismaStatus(requests, "RESOLVED");
  const highRisk = countByField(requests, "riskLevel", "High");

  const recovered = approved + resolved;
  const recoveryRate = hasData ? Math.round((recovered / total) * 100) : 0;

  const topReason = getMostCommon(requests, "reason");
  const topOption = getMostCommon(requests, "selectedOption");
  const topRisk = getTopRiskCategory(requests);

  const reasonBreakdown = buildBreakdown(
    requests,
    "reason",
    reasonLabels,
    ALL_REASONS,
  );
  const optionBreakdown = buildBreakdown(
    requests,
    "selectedOption",
    null,
    ALL_OPTIONS,
  );

  return (
    <main
      className="min-h-screen px-4 py-10"
      style={{
        backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Return Recovery Copilot
            </p>
            <h1 className="text-2xl font-bold text-slate-900">
              Analytics Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Overview of return requests and recovery performance
            </p>
          </div>
          <a
            href="/dashboard"
            className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-full px-4 py-2 shadow-sm transition-all duration-150"
          >
            ← Back to Dashboard
          </a>
        </div>

        {loading && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-sm font-medium">Loading analytics…</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 inline-block">
              {loadError}
            </p>
          </div>
        )}

        {!loading && !loadError && !hasData && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm text-center py-20 px-6">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-base font-semibold text-slate-700">
              No return requests yet
            </p>
            <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
              Analytics will appear here once customers submit return requests
              through your store.
            </p>
            <a
              href="/"
              className="inline-block mt-6 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-700 px-5 py-2.5 rounded-xl transition-colors"
            >
              View customer return form
            </a>
          </div>
        )}

        {!loading && !loadError && hasData && (
          <>
            {/* Recovery rate highlight */}
            <div className="rounded-2xl border border-slate-200 bg-slate-900 text-white p-6 mb-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                Recovery Rate
              </p>
              <p className="text-5xl font-bold leading-none">{recoveryRate}%</p>
              <p className="text-sm text-slate-400 mt-3">
                {recovered} of {total} requests approved or resolved
              </p>
              <div className="mt-4 h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full"
                  style={{ width: `${recoveryRate}%` }}
                />
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              <StatCard label="Total Requests" value={total} />
              <StatCard
                label="Approved"
                value={approved}
                accent="text-emerald-700"
              />
              <StatCard
                label="Pending"
                value={pending}
                accent="text-amber-700"
              />
              <StatCard
                label="Resolved"
                value={resolved}
                accent="text-slate-600"
              />
              <StatCard
                label="High Risk"
                value={highRisk}
                accent="text-red-700"
                sub="Risk level: High"
              />
            </div>

            {/* Top insights */}
            <div className="grid sm:grid-cols-3 gap-4 mb-6">
              <InsightCard
                label="Most Common Return Reason"
                value={
                  topReason.key
                    ? (reasonLabels[topReason.key] ?? topReason.key)
                    : "—"
                }
                detail={
                  topReason.count > 0
                    ? `${topReason.count} request${topReason.count === 1 ? "" : "s"}`
                    : undefined
                }
              />
              <InsightCard
                label="Most Selected Recovery Option"
                value={topOption.key ?? "—"}
                detail={
                  topOption.count > 0
                    ? `${topOption.count} request${topOption.count === 1 ? "" : "s"}`
                    : undefined
                }
              />
              <InsightCard
                label="Highest Risk Category"
                value={topRisk.key ?? "—"}
                detail={
                  topRisk.count > 0
                    ? `${topRisk.count} request${topRisk.count === 1 ? "" : "s"} at this level`
                    : undefined
                }
              />
            </div>

            {/* Breakdowns */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 mb-1">
                  Return Reason Breakdown
                </h2>
                <p className="text-xs text-slate-400 mb-5">
                  Why customers are returning items
                </p>
                <div className="space-y-4">
                  {reasonBreakdown.map((row) => (
                    <BreakdownRow
                      key={row.key}
                      label={row.label}
                      count={row.count}
                      total={total}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 mb-1">
                  Recovery Option Breakdown
                </h2>
                <p className="text-xs text-slate-400 mb-5">
                  Preferred resolutions customers chose
                </p>
                <div className="space-y-4">
                  {optionBreakdown.map((row) => (
                    <BreakdownRow
                      key={row.key}
                      label={row.label}
                      count={row.count}
                      total={total}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <p className="text-center text-xs text-slate-400 mt-8">
          Powered by Return Recovery Copilot
        </p>
      </div>
    </main>
  );
}
