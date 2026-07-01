"use client";

import { useEffect } from "react";

/**
 * Global App Router error boundary.
 * Shows a safe fallback UI — never renders stack traces or raw error details.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error(error);
    }
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Error
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-slate-600 mb-8">
            Please refresh the page or try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-full px-5 py-2.5 shadow-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
