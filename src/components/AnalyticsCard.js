/**
 * Single metric tile used in return request cards (AI score, risk, best action).
 */
export default function AnalyticsCard({
  label,
  value,
  subtitle,
  valueClassName = "text-2xl font-bold text-slate-900 leading-none",
  subtitleClassName = "text-xs text-slate-400 mt-3",
  barPercent,
  barColorClass,
}) {
  return (
    <div className="bg-slate-50 rounded-xl p-3.5">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
        {label}
      </p>
      <p className={valueClassName}>{value}</p>
      {barPercent !== undefined && (
        <div className="mt-2 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${barColorClass ?? "bg-slate-800"} transition-all duration-500`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      )}
      {subtitle && <p className={subtitleClassName}>{subtitle}</p>}
    </div>
  );
}
