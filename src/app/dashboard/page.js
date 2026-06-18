"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import RequestCard from "@/components/RequestCard";

const STATUS_FILTERS = [
  { id: "ALL", label: "All", statuses: null },
  { id: "PENDING", label: "Pending", statuses: ["PENDING"] },
  { id: "IN_REVIEW", label: "Needs Attention", statuses: ["IN_REVIEW"] },
  { id: "APPROVED", label: "Approved", statuses: ["APPROVED"] },
  { id: "RESOLVED", label: "Resolved", statuses: ["RESOLVED"] },
  { id: "REJECTED", label: "Rejected", statuses: ["REJECTED"] },
];

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

function countForFilter(requests, filter) {
  if (!filter.statuses) return requests.length;
  return requests.filter((r) => filter.statuses.includes(getPrismaStatus(r))).length;
}

function matchesFilter(request, filter) {
  if (!filter.statuses) return true;
  return filter.statuses.includes(getPrismaStatus(request));
}

const SORT_OPTIONS = [
  { id: "NEWEST", label: "Newest First" },
  { id: "OLDEST", label: "Oldest First" },
  { id: "PENDING_FIRST", label: "Pending First" },
  { id: "APPROVED_FIRST", label: "Approved First" },
  { id: "REJECTED_FIRST", label: "Rejected First" },
  { id: "HIGH_RISK_FIRST", label: "High Risk First" },
  { id: "LOW_RISK_FIRST", label: "Low Risk First" },
];

const DEFAULT_SORT = "NEWEST";

function getCreatedAtMs(request) {
  const ms = new Date(request.createdAt ?? 0).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function statusSortRank(request, preferredStatuses) {
  const status = getPrismaStatus(request);
  const idx = preferredStatuses.indexOf(status);
  return idx === -1 ? preferredStatuses.length : idx;
}

function riskSortRank(request, highFirst) {
  const order = highFirst
    ? { High: 0, Medium: 1, Low: 2 }
    : { Low: 0, Medium: 1, High: 2 };
  return order[request.riskLevel] ?? 1;
}

function sortRequests(requests, sortId) {
  const list = [...requests];
  const byNewestTiebreak = (a, b) => getCreatedAtMs(b) - getCreatedAtMs(a);

  switch (sortId) {
    case "OLDEST":
      return list.sort((a, b) => getCreatedAtMs(a) - getCreatedAtMs(b));
    case "PENDING_FIRST":
      return list.sort((a, b) => {
        const diff =
          statusSortRank(a, ["PENDING", "IN_REVIEW"]) -
          statusSortRank(b, ["PENDING", "IN_REVIEW"]);
        return diff !== 0 ? diff : byNewestTiebreak(a, b);
      });
    case "APPROVED_FIRST":
      return list.sort((a, b) => {
        const diff =
          statusSortRank(a, ["APPROVED"]) - statusSortRank(b, ["APPROVED"]);
        return diff !== 0 ? diff : byNewestTiebreak(a, b);
      });
    case "REJECTED_FIRST":
      return list.sort((a, b) => {
        const diff =
          statusSortRank(a, ["REJECTED"]) - statusSortRank(b, ["REJECTED"]);
        return diff !== 0 ? diff : byNewestTiebreak(a, b);
      });
    case "HIGH_RISK_FIRST":
      return list.sort((a, b) => {
        const diff = riskSortRank(a, true) - riskSortRank(b, true);
        return diff !== 0 ? diff : byNewestTiebreak(a, b);
      });
    case "LOW_RISK_FIRST":
      return list.sort((a, b) => {
        const diff = riskSortRank(a, false) - riskSortRank(b, false);
        return diff !== 0 ? diff : byNewestTiebreak(a, b);
      });
    case "NEWEST":
    default:
      return list.sort(byNewestTiebreak);
  }
}

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

/** Pick an action that preserves status when saving a note only */
function actionForNoteSave(status) {
  switch (status) {
    case "Approved":
      return "APPROVE";
    case "Manual Review":
      return "NEEDS_MORE_INFO";
    case "Needs Attention":
      return "REJECT";
    case "Resolved":
      return "RESOLVE";
    default:
      return "NEEDS_MORE_INFO";
  }
}

// ── Dashboard Page ────────────────────────────────────────────────
export default function Dashboard() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [actionErrors, setActionErrors] = useState({});
  const [actionEmailFeedback, setActionEmailFeedback] = useState({});
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [sortOption, setSortOption] = useState(DEFAULT_SORT);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncHelper, setSyncHelper] = useState("");
  const [syncSummary, setSyncSummary] = useState(null);
  const [productSyncing, setProductSyncing] = useState(false);
  const [productSyncMessage, setProductSyncMessage] = useState("");
  const [productSyncError, setProductSyncError] = useState("");
  const [productSyncWarnings, setProductSyncWarnings] = useState([]);

  const pendingCount = countForFilter(requests, STATUS_FILTERS[1]);
  const attentionCount = countForFilter(requests, STATUS_FILTERS[2]);

  const activeFilterDef =
    STATUS_FILTERS.find((f) => f.id === activeFilter) ?? STATUS_FILTERS[0];

  const filteredRequests = useMemo(
    () => requests.filter((r) => matchesFilter(r, activeFilterDef)),
    [requests, activeFilterDef]
  );

  const displayRequests = useMemo(
    () => sortRequests(filteredRequests, sortOption),
    [filteredRequests, sortOption]
  );

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/requests");
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLoadError(data.message || "Failed to load return requests.");
        setRequests([]);
        return;
      }
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      setLoadError("Failed to load return requests.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  async function handleSyncShopifyOrders() {
    if (syncing) {
      return;
    }

    setSyncing(true);
    setSyncMessage("");
    setSyncError("");
    setSyncHelper("");
    setSyncSummary(null);

    try {
      const res = await fetch("/api/shopify/orders/sync", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 429) {
          setSyncError(
            "Too many sync attempts. Please wait a few minutes and try again."
          );
        } else if (data.code === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED") {
          setSyncError(
            "Shopify connection works, but order sync needs Protected Customer Data access approval."
          );
          setSyncHelper(
            "Go to Shopify Partner Dashboard > API access > Protected customer data access. Add read_orders, request approval, then reinstall the app."
          );
        } else {
          setSyncError("Unable to sync Shopify orders");
        }
        return;
      }

      setSyncMessage("Shopify orders synced successfully");
      setSyncSummary({
        ordersCreated: data.orders?.created ?? 0,
        ordersUpdated: data.orders?.updated ?? 0,
        itemsSynced: data.items?.totalSynced ?? 0,
      });
      await loadRequests();
    } catch {
      setSyncError("Unable to sync Shopify orders");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncProducts() {
    if (productSyncing) {
      return;
    }

    setProductSyncing(true);
    setProductSyncMessage("");
    setProductSyncError("");
    setProductSyncWarnings([]);

    try {
      const res = await fetch("/api/shopify/products/sync", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.error === "Missing Shopify connection") {
          setProductSyncError("Missing Shopify connection");
        } else if (res.status === 401 || data.error === "Unauthorized") {
          setProductSyncError("Unauthorized");
        } else {
          setProductSyncError(data.error || "Unable to sync Shopify products");
        }
        return;
      }

      setProductSyncMessage(
        `Synced ${data.productsSynced ?? 0} products and ${data.variantsSynced ?? 0} variants.`
      );

      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setProductSyncWarnings(data.warnings);
      }
    } catch {
      setProductSyncError("Unable to sync Shopify products");
    } finally {
      setProductSyncing(false);
    }
  }

  function handleRequestUpdated(updatedRequest) {
    setRequests((prev) =>
      prev.map((r) => (r.id === updatedRequest.id ? updatedRequest : r))
    );
  }

  async function performAction(request, action, merchantNote) {
    setUpdatingId(request.id);
    setActionErrors((prev) => ({ ...prev, [request.id]: "" }));
    setActionEmailFeedback((prev) => ({ ...prev, [request.id]: "" }));

    try {
      const body = { action };
      if (merchantNote !== undefined && merchantNote !== "") {
        body.merchantNote = merchantNote;
      }

      const res = await fetch(`/api/requests/${request.id}/action`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const message = data.message || "Update failed.";
        setActionErrors((prev) => ({ ...prev, [request.id]: message }));
        throw new Error(message);
      }

      handleRequestUpdated(data.request);

      if (data.email?.sent === true) {
        setActionEmailFeedback((prev) => ({
          ...prev,
          [request.id]: "success",
        }));
      } else if (data.email?.sent === false && data.email?.error) {
        setActionEmailFeedback((prev) => ({
          ...prev,
          [request.id]: "warning",
        }));
      }

      await loadRequests();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Update failed.";
      setActionErrors((prev) => ({ ...prev, [request.id]: message }));
      throw error;
    } finally {
      setUpdatingId(null);
    }
  }

  function handleApprove(request) {
    return (merchantNote) => performAction(request, "APPROVE", merchantNote);
  }

  function handleReject(request) {
    return (merchantNote) => performAction(request, "REJECT", merchantNote);
  }

  function handleManualReview(request) {
    return (merchantNote) => performAction(request, "NEEDS_MORE_INFO", merchantNote);
  }

  function handleResolve(request) {
    return (merchantNote) => performAction(request, "RESOLVE", merchantNote);
  }

  function handleNoteChange(request) {
    return (merchantNote) =>
      performAction(request, actionForNoteSave(request.status), merchantNote);
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
            <button
              type="button"
              onClick={handleSyncShopifyOrders}
              disabled={syncing}
              className="text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed rounded-full px-4 py-2 shadow-sm transition-all duration-150"
            >
              {syncing ? "Syncing..." : "Sync Shopify Orders"}
            </button>
            <button
              type="button"
              onClick={handleSyncProducts}
              disabled={productSyncing}
              className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed rounded-full px-4 py-2 shadow-sm transition-all duration-150"
            >
              {productSyncing ? "Syncing products..." : "Sync Products"}
            </button>
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

        {(syncMessage || syncError || syncHelper || syncSummary) && (
          <div className="mb-6 space-y-2">
            {syncMessage && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                {syncMessage}
              </p>
            )}
            {syncSummary && (
              <p className="text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-3">
                Orders created: {syncSummary.ordersCreated}
                {" · "}
                Orders updated: {syncSummary.ordersUpdated}
                {" · "}
                Items synced: {syncSummary.itemsSynced}
              </p>
            )}
            {syncError && (
              <p
                className={`text-sm rounded-xl px-4 py-3 border ${
                  syncHelper
                    ? "text-amber-800 bg-amber-50 border-amber-200"
                    : "text-red-600 bg-red-50 border-red-200"
                }`}
              >
                {syncError}
              </p>
            )}
            {syncHelper && (
              <p className="text-xs text-amber-700 bg-amber-50/80 border border-amber-200 rounded-xl px-4 py-3">
                {syncHelper}
              </p>
            )}
          </div>
        )}

        {(productSyncMessage || productSyncError || productSyncWarnings.length > 0) && (
          <div className="mb-6 space-y-2">
            {productSyncMessage && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                {productSyncMessage}
              </p>
            )}
            {productSyncWarnings.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                {productSyncWarnings.map((warning, index) => (
                  <p key={`${index}-${warning}`}>{warning}</p>
                ))}
              </div>
            )}
            {productSyncError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {productSyncError}
              </p>
            )}
          </div>
        )}

        {!loading && !loadError && requests.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 justify-between">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => {
                const count = countForFilter(requests, filter);
                const isActive = activeFilter === filter.id;

                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setActiveFilter(filter.id)}
                    className={`inline-flex items-center gap-2 text-xs font-semibold rounded-full px-4 py-2 border shadow-sm transition-all duration-150
                      ${
                        isActive
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                  >
                    {filter.label}
                    <span
                      className={`inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold
                        ${
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="inline-flex items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-slate-500 sr-only">
                Sort requests
              </span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-full px-4 py-2 shadow-sm transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1"
                aria-label="Sort return requests"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {loading && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-sm font-medium">Loading return requests…</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 inline-block">
              {loadError}
            </p>
          </div>
        )}

        {!loading && !loadError && requests.length === 0 && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm font-medium">No return requests yet.</p>
            <p className="text-xs mt-1">Submitted requests will appear here.</p>
          </div>
        )}

        {!loading && !loadError && requests.length > 0 && filteredRequests.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm font-medium">No requests match this filter.</p>
            <button
              type="button"
              onClick={() => setActiveFilter("ALL")}
              className="mt-3 text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
            >
              Show all requests
            </button>
          </div>
        )}

        <div className="space-y-4">
          {!loading &&
            !loadError &&
            displayRequests.map((request) => {
            const risk =
              riskConfig[request.riskLevel] ?? riskConfig["Medium"];

            return (
              <RequestCard
                key={request.id}
                request={request}
                risk={risk}
                isUpdating={updatingId === request.id}
                actionError={actionErrors[request.id] || ""}
                emailFeedback={actionEmailFeedback[request.id] || ""}
                onApprove={handleApprove(request)}
                onReject={handleReject(request)}
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
