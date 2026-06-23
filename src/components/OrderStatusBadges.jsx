function formatLabel(value) {
  return String(value).replace(/_/g, " ");
}

function hasStatusValue(value) {
  return value != null && String(value).trim() !== "";
}

function orderStatusBadgeClass(status) {
  switch (String(status ?? "").toUpperCase()) {
    case "PAID":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "FULFILLED":
    case "DELIVERED":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "PENDING":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "CANCELLED":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function financialStatusBadgeClass(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "paid":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "refunded":
    case "partially_refunded":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function fulfillmentStatusBadgeClass(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "fulfilled":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "unfulfilled":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "partial":
      return "bg-orange-50 text-orange-700 border-orange-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function StatusPill({ label, value, badgeClass }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-slate-500">{label}:</span>
      <span
        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badgeClass}`}
      >
        {formatLabel(value)}
      </span>
    </div>
  );
}

function formatCancelledAt(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString();
}

export default function OrderStatusBadges({ orderStatus }) {
  const status = orderStatus?.status ?? null;
  const financialStatus = orderStatus?.financialStatus ?? null;
  const fulfillmentStatus = orderStatus?.fulfillmentStatus ?? null;
  const cancelledAt = formatCancelledAt(orderStatus?.cancelledAt);

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
        Order Status
      </p>
      <div className="space-y-1.5">
        <StatusPill
          label="Status"
          value={hasStatusValue(status) ? status : "Unknown"}
          badgeClass={orderStatusBadgeClass(status)}
        />
        {hasStatusValue(financialStatus) && (
          <StatusPill
            label="Payment"
            value={financialStatus}
            badgeClass={financialStatusBadgeClass(financialStatus)}
          />
        )}
        {hasStatusValue(fulfillmentStatus) && (
          <StatusPill
            label="Fulfillment"
            value={fulfillmentStatus}
            badgeClass={fulfillmentStatusBadgeClass(fulfillmentStatus)}
          />
        )}
        {cancelledAt && (
          <p className="text-xs text-red-700 font-medium pt-0.5">
            Cancelled: {cancelledAt}
          </p>
        )}
      </div>
    </div>
  );
}
