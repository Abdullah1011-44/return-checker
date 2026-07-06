"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchMerchantJson,
  getApiErrorMessage,
  readObjectField,
} from "@/lib/dashboardFetch";
import { formatRecoveredAmountDisplay } from "@/lib/offerAcceptanceAnalytics";

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

const RECOVERY_RANGE_OPTIONS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
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

function countByField(requests, field, value) {
  let count = 0;
  for (const request of requests) {
    if (request[field] === value) count++;
  }
  return count;
}

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

function formatAudCents(cents) {
  return formatRecoveredAmountDisplay(cents, "AUD");
}

function formatRecoveryRatePercent(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function formatReasonLabel(reasonKey) {
  if (!reasonKey) {
    return "Unknown";
  }

  return reasonLabels[reasonKey] ?? String(reasonKey).replace(/_/g, " ");
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

function TrendRow({ label, count, cents, maxCents }) {
  const percent =
    maxCents > 0 ? Math.round((cents / maxCents) * 100) : count > 0 ? 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500 whitespace-nowrap shrink-0">
          {formatAudCents(cents)}{" "}
          <span className="text-slate-400">
            ({count} offer{count === 1 ? "" : "s"})
          </span>
        </span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-600 rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function RecoveryTable({ columns, rows, emptyMessage }) {
  if (!rows.length) {
    return (
      <p className="text-sm text-slate-500 bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-slate-400 border-b border-slate-100">
            {columns.map((column) => (
              <th key={column.key} className="py-2 pr-4 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-slate-50 last:border-b-0"
            >
              {columns.map((column) => (
                <td key={column.key} className="py-3 pr-4 text-slate-700">
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const [requests, setRequests] = useState([]);
  const [offerAcceptanceSummary, setOfferAcceptanceSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [recoveryAnalytics, setRecoveryAnalytics] = useState(null);
  const [recoveryRange, setRecoveryRange] = useState("30d");
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const { res, data, aborted } = await fetchMerchantJson("/api/requests");

      if (aborted) {
        setLoadError("Could not load analytics.");
        setRequests([]);
        setOfferAcceptanceSummary(null);
        return;
      }

      if (!res?.ok || data?.success !== true) {
        setLoadError(
          getApiErrorMessage(res, data, "Could not load analytics."),
        );
        setRequests([]);
        setOfferAcceptanceSummary(null);
        return;
      }

      const nextRequests = Array.isArray(data.requests) ? data.requests : [];
      setRequests(nextRequests);
      setOfferAcceptanceSummary(
        readObjectField(data, "offerAcceptanceSummary"),
      );
      setLoadError("");
    } catch (error) {
      console.error("[analytics] Failed to load return requests.", {
        name: error instanceof Error ? error.name : "Error",
      });
      setLoadError("Could not load analytics.");
      setRequests([]);
      setOfferAcceptanceSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecoveryAnalytics = useCallback(async (range) => {
    setRecoveryLoading(true);
    setRecoveryError("");

    try {
      const { res, data, aborted } = await fetchMerchantJson(
        `/api/dashboard/recovery?range=${encodeURIComponent(range)}`,
      );

      if (aborted) {
        setRecoveryError("Could not load recovery analytics.");
        setRecoveryAnalytics(null);
        return;
      }

      if (!res?.ok || data?.success !== true) {
        setRecoveryError(
          getApiErrorMessage(res, data, "Could not load recovery analytics."),
        );
        setRecoveryAnalytics(null);
        return;
      }

      setRecoveryAnalytics(data);
      setRecoveryError("");
    } catch (error) {
      console.error("[analytics] Failed to load recovery analytics.", {
        name: error instanceof Error ? error.name : "Error",
      });
      setRecoveryError("Could not load recovery analytics.");
      setRecoveryAnalytics(null);
    } finally {
      setRecoveryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    loadRecoveryAnalytics(recoveryRange);
  }, [loadRecoveryAnalytics, recoveryRange]);

  const total = requests.length;
  const hasOperationalData = total > 0;

  const approved = countByPrismaStatus(requests, "APPROVED");
  const pending = countByPrismaStatus(requests, "PENDING", "IN_REVIEW");
  const resolved = countByPrismaStatus(requests, "RESOLVED");
  const highRisk = countByField(requests, "riskLevel", "High");

  const completed = approved + resolved;
  const requestCompletionRate = hasOperationalData
    ? Math.round((completed / total) * 100)
    : 0;

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

  const acceptance = offerAcceptanceSummary ?? {
    totalAcceptedOffers: 0,
    acceptedExchangeCount: 0,
    acceptedStoreCreditCount: 0,
    acceptedPartialRefundCount: 0,
    manualReviewCount: 0,
    legalReviewRequiredCount: 0,
    acceptanceByOfferType: {},
    acceptanceBySource: {},
  };

  const recoverySummary = recoveryAnalytics?.summary ?? {
    estimatedRefundAvoidedCents: 0,
    acceptedRecoveryOffers: 0,
    recoveryRate: 0,
    averageRecoveryValueCents: 0,
    pendingOfferDecisions: 0,
    smallSampleCaveat: true,
  };

  const recoveryOfferTypes = Array.isArray(recoveryAnalytics?.offerTypes)
    ? recoveryAnalytics.offerTypes
    : [];
  const recoveryTrend = Array.isArray(recoveryAnalytics?.trend)
    ? recoveryAnalytics.trend
    : [];
  const topProducts = Array.isArray(recoveryAnalytics?.topProducts)
    ? recoveryAnalytics.topProducts
    : [];
  const topReasons = Array.isArray(recoveryAnalytics?.topReasons)
    ? recoveryAnalytics.topReasons
    : [];

  const recoveryOfferTypeTotal = recoveryOfferTypes.reduce(
    (sum, row) => sum + (row.count ?? 0),
    0,
  );

  const sourceBreakdown = [
    {
      key: "CUSTOMER_SELECTED",
      label: "Customer selected",
      count: acceptance.acceptanceBySource?.CUSTOMER_SELECTED ?? 0,
    },
    {
      key: "RULE_ENGINE",
      label: "Rule engine",
      count: acceptance.acceptanceBySource?.RULE_ENGINE ?? 0,
    },
    {
      key: "FOLLOW_UP_ENGINE",
      label: "Follow-up engine",
      count: acceptance.acceptanceBySource?.FOLLOW_UP_ENGINE ?? 0,
    },
    {
      key: "MERCHANT_MANUAL",
      label: "Merchant manual",
      count: acceptance.acceptanceBySource?.MERCHANT_MANUAL ?? 0,
    },
    {
      key: "SYSTEM_DEFAULT",
      label: "System default",
      count: acceptance.acceptanceBySource?.SYSTEM_DEFAULT ?? 0,
    },
  ];

  const acceptanceTotal = acceptance.totalAcceptedOffers ?? 0;
  const sourceTotal = sourceBreakdown.reduce((sum, row) => sum + row.count, 0);
  const maxTrendCents = recoveryTrend.reduce(
    (max, row) => Math.max(max, row.estimatedRefundAvoidedCents ?? 0),
    0,
  );

  const hasAcceptedRecoveryOffers =
    (recoverySummary.acceptedRecoveryOffers ?? 0) > 0;

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

        <section className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Recovery performance
            </p>
            <div className="flex flex-wrap gap-2">
              {RECOVERY_RANGE_OPTIONS.map((option) => {
                const active = recoveryRange === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRecoveryRange(option.id)}
                    className={`text-xs font-semibold rounded-full px-4 py-2 border transition-all duration-150 ${
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
              <a
                href={`/api/dashboard/recovery/export?range=${encodeURIComponent(recoveryRange)}`}
                className="text-xs font-semibold rounded-full px-4 py-2 border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-all duration-150"
              >
                Export CSV
              </a>
            </div>
          </div>

          {recoveryLoading && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm text-center py-16 px-6">
              <p className="text-sm text-slate-400 font-medium">
                Loading recovery analytics…
              </p>
            </div>
          )}

          {!recoveryLoading && recoveryError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 shadow-sm text-center py-12 px-6">
              <p className="text-sm text-red-600">{recoveryError}</p>
            </div>
          )}

          {!recoveryLoading && !recoveryError && (
            <>
              <div className="rounded-2xl border border-slate-200 bg-slate-900 text-white p-6 mb-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                  Estimated Refund Avoided
                </p>
                <p className="text-5xl font-bold leading-none">
                  {formatAudCents(recoverySummary.estimatedRefundAvoidedCents)}
                </p>
                <p className="text-sm text-slate-400 mt-3">
                  {recoverySummary.acceptedRecoveryOffers ?? 0} accepted
                  recovery offer
                  {(recoverySummary.acceptedRecoveryOffers ?? 0) === 1
                    ? ""
                    : "s"}
                </p>
                <p className="text-xs text-slate-500 mt-4 max-w-2xl leading-relaxed">
                  Estimated refund avoided includes accepted exchanges, store
                  credit, and partial refunds. Store credit represents retained
                  store value, not immediate cash.
                </p>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard
                  label="Accepted Recovery Offers"
                  value={recoverySummary.acceptedRecoveryOffers ?? 0}
                  accent="text-indigo-700"
                />
                <StatCard
                  label="Recovery Rate"
                  value={formatRecoveryRatePercent(
                    recoverySummary.recoveryRate,
                  )}
                  accent="text-emerald-700"
                  sub={
                    recoverySummary.smallSampleCaveat
                      ? "Small sample — interpret with caution"
                      : undefined
                  }
                />
                <StatCard
                  label="Average Recovery Value"
                  value={formatAudCents(
                    recoverySummary.averageRecoveryValueCents,
                  )}
                  accent="text-slate-800"
                />
                <StatCard
                  label="Pending Decisions"
                  value={recoverySummary.pendingOfferDecisions ?? 0}
                  accent="text-amber-700"
                  sub="Current snapshot"
                />
              </div>

              {!hasAcceptedRecoveryOffers && (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm text-center py-12 px-6 mb-6">
                  <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
                    No accepted recovery offers yet. Recovery analytics will
                    appear once customers accept exchange, store credit, or
                    partial refund offers.
                  </p>
                </div>
              )}

              {hasAcceptedRecoveryOffers && recoveryTrend.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
                  <h2 className="text-sm font-bold text-slate-900 mb-1">
                    Recovery Trend
                  </h2>
                  <p className="text-xs text-slate-400 mb-5">
                    Estimated refund avoided by day (
                    {recoveryAnalytics?.timezone ?? "Australia/Sydney"})
                  </p>
                  <div className="space-y-4">
                    {recoveryTrend.map((row) => (
                      <TrendRow
                        key={row.date}
                        label={row.date}
                        count={row.acceptedRecoveryOffers ?? 0}
                        cents={row.estimatedRefundAvoidedCents ?? 0}
                        maxCents={maxTrendCents}
                      />
                    ))}
                  </div>
                </div>
              )}

              {hasAcceptedRecoveryOffers && topProducts.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
                  <h2 className="text-sm font-bold text-slate-900 mb-1">
                    Top Products by Recovery
                  </h2>
                  <p className="text-xs text-slate-400 mb-5">
                    Products with the highest estimated refund avoided
                  </p>
                  <RecoveryTable
                    columns={[
                      { key: "product", label: "Product" },
                      { key: "offers", label: "Accepted Offers" },
                      { key: "amount", label: "Estimated Refund Avoided" },
                    ]}
                    rows={topProducts.map((row) => ({
                      key: row.key,
                      product: row.label ?? row.key,
                      offers: row.count ?? 0,
                      amount: formatAudCents(row.estimatedRefundAvoidedCents),
                    }))}
                    emptyMessage="No product recovery data for this period."
                  />
                </div>
              )}

              {hasAcceptedRecoveryOffers && topReasons.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
                  <h2 className="text-sm font-bold text-slate-900 mb-1">
                    Top Reasons by Recovery
                  </h2>
                  <p className="text-xs text-slate-400 mb-5">
                    Return reasons driving the most estimated refund avoided
                  </p>
                  <RecoveryTable
                    columns={[
                      { key: "reason", label: "Reason" },
                      { key: "offers", label: "Accepted Offers" },
                      { key: "amount", label: "Estimated Refund Avoided" },
                    ]}
                    rows={topReasons.map((row) => ({
                      key: row.key,
                      reason: formatReasonLabel(row.label ?? row.key),
                      offers: row.count ?? 0,
                      amount: formatAudCents(row.estimatedRefundAvoidedCents),
                    }))}
                    emptyMessage="No reason recovery data for this period."
                  />
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
            Return operations
          </p>

          {loading && (
            <div className="text-center py-20 text-slate-400">
              <p className="text-sm font-medium">Loading return analytics…</p>
            </div>
          )}

          {!loading && loadError && (
            <div className="text-center py-12">
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 inline-block">
                {loadError}
              </p>
            </div>
          )}

          {!loading && !loadError && !hasOperationalData && (
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

          {!loading && !loadError && hasOperationalData && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
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
                <StatCard
                  label="Request Completion Rate"
                  value={`${requestCompletionRate}%`}
                  accent="text-slate-800"
                  sub={`${completed} of ${total} approved or resolved`}
                />
              </div>

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

              {(acceptanceTotal > 0 || recoveryOfferTypeTotal > 0) && (
                <div className="grid md:grid-cols-2 gap-6 mb-6">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-900 mb-1">
                      Accepted Offer Breakdown
                    </h2>
                    <p className="text-xs text-slate-400 mb-5">
                      Accepted recovery offers in the selected period
                    </p>
                    <div className="space-y-4">
                      {recoveryOfferTypes.map((row) => (
                        <BreakdownRow
                          key={row.type}
                          label={row.label ?? row.type}
                          count={row.count ?? 0}
                          total={recoveryOfferTypeTotal || 1}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                      Estimated Refund Avoided:{" "}
                      {formatAudCents(
                        recoverySummary.estimatedRefundAvoidedCents,
                      )}
                    </p>
                  </div>

                  {sourceTotal > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h2 className="text-sm font-bold text-slate-900 mb-1">
                        Acceptance by Source
                      </h2>
                      <p className="text-xs text-slate-400 mb-5">
                        How accepted offers were determined (current snapshot)
                      </p>
                      <div className="space-y-4">
                        {sourceBreakdown.map((row) => (
                          <BreakdownRow
                            key={row.key}
                            label={row.label}
                            count={row.count}
                            total={sourceTotal}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
                <h2 className="text-sm font-bold text-slate-900 mb-1">
                  Operational Queue
                </h2>
                <p className="text-xs text-slate-400 mb-5">
                  Items requiring merchant attention (current snapshot)
                </p>
                <div className="grid sm:grid-cols-3 gap-4">
                  <StatCard
                    label="Manual Review"
                    value={acceptance.manualReviewCount ?? 0}
                    accent="text-amber-700"
                  />
                  <StatCard
                    label="Legal Review"
                    value={acceptance.legalReviewRequiredCount ?? 0}
                    accent="text-red-700"
                  />
                  <StatCard
                    label="Pending Decisions"
                    value={recoverySummary.pendingOfferDecisions ?? 0}
                    accent="text-slate-700"
                  />
                </div>
              </div>

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
        </section>

        <p className="text-center text-xs text-slate-400 mt-8">
          Powered by Return Recovery Copilot
        </p>
      </div>
    </main>
  );
}
