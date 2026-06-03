export default function StatusBadge({ status }) {
    const normalizedStatus = status?.toLowerCase();
  
    let badgeClass = "bg-slate-100 text-slate-700 border-slate-200";
  
    if (normalizedStatus === "approved") {
      badgeClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
    }
  
    if (normalizedStatus === "pending review") {
      badgeClass = "bg-amber-100 text-amber-700 border-amber-200";
    }
  
    if (normalizedStatus === "resolved") {
      badgeClass = "bg-blue-100 text-blue-700 border-blue-200";
    }
  
    if (normalizedStatus === "manual review") {
      badgeClass = "bg-red-100 text-red-700 border-red-200";
    }

    if (normalizedStatus === "needs attention") {
      badgeClass = "bg-red-100 text-red-700 border-red-200";
    }
  
    return (
      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>
        {status}
      </span>
    );
  }