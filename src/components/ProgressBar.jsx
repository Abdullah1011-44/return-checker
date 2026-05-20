export default function ProgressBar({
    percent = 0,
    barColorClass = "bg-blue-500",
    trackColorClass = "bg-slate-200",
  }) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  
    return (
      <div className={`h-2 w-full rounded-full ${trackColorClass}`}>
        <div
          className={`h-2 rounded-full ${barColorClass}`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
    );
  }