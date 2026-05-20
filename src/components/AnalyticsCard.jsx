export default function AnalyticsCard({
    label,
    value,
    subtitle,
    subtitleClassName = "text-xs text-slate-500 mt-1",
    barPercent,
    barColorClass = "bg-blue-500",
  }) {
    return (
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
  
        {subtitle && (
          <p className={subtitleClassName}>{subtitle}</p>
        )}
  
        {barPercent !== undefined && (
          <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
            <div
              className={`h-2 rounded-full ${barColorClass}`}
              style={{ width: `${barPercent}%` }}
            />
          </div>
        )}
      </div>
    );
  }