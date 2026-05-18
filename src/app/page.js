"use client";
import { useState } from "react";

// ── Step indicator ───────────────────────────────────────────────
function StepBadge({ step, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
      <span className="w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-bold">
        {step}
      </span>
      {label}
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function Home() {
  // Step: "check" | "details" | "confirm"
  const [step, setStep] = useState("check");

  // Step 1 fields
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");

  // Step 2 fields
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [proofImage, setProofImage]       = useState(""); // base64 string
  const [imagePreview, setImagePreview]   = useState(""); // object URL for preview
  const [selectedOption, setSelectedOption] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Step 1: Check eligibility ──────────────────────────────────
  async function handleCheck(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/check-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, email }),
      });
      const data = await res.json();

      if (data.status === "approved") {
        setStep("details");
      } else if (data.status === "rejected") {
        setError("Your order is not eligible for a return.");
      } else {
        setError("Order not found. Please check your order number and email.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Submit final request ───────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason) { setError("Please select a return reason."); return; }
    if (!selectedOption) { setError("Please select a preferred option."); return; }
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/submit-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, email, reason, comment, selectedOption, proofImage }),
      });
      const data = await res.json();

      if (data.success) {
        setStep("confirm");
      } else {
        setError("Failed to submit. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Reset everything ───────────────────────────────────────────
  function handleReset() {
    setStep("check");
    setOrderNumber("");
    setEmail("");
    setReason("");
    setComment("");
    setSelectedOption("");
    setError("");
    setProofImage("");
   setImagePreview("");
  }
  function handleImageChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Show a quick preview via object URL
  setImagePreview(URL.createObjectURL(file));

  // Convert to base64 for storage
  const reader = new FileReader();
  reader.onloadend = () => setProofImage(reader.result); // reader.result = "data:image/...;base64,..."
  reader.readAsDataURL(file);
}

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        backgroundColor: "#f8fafc",
        backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/80 overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-8 py-6 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute -right-2 -bottom-8 w-16 h-16 rounded-full bg-white/5 pointer-events-none" />
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1 relative z-10">
              Shopify · Return Checker
            </p>
            <h1 className="text-white text-2xl font-bold tracking-tight relative z-10">
              {step === "check" && "Check Your Return"}
              {step === "details" && "Tell Us More"}
              {step === "confirm" && "Request Submitted"}
            </h1>
          </div>

          <div className="px-8 py-8">

            {/* ── STEP 1: Order lookup ── */}
            {step === "check" && (
              <form onSubmit={handleCheck} className="space-y-5">
                <StepBadge step="1" label="Verify your order" />

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">
                    Order Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 1001, 1002, 1003"
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

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm shadow-md shadow-slate-800/20"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Checking…
                    </>
                  ) : (
                    <>Check Return Status <span className="opacity-70">→</span></>
                  )}
                </button>

                <p className="text-center text-xs text-slate-400 pt-1">
                  Try orders{" "}
                  <span className="font-medium text-slate-500">1001</span> /{" "}
                  <span className="font-medium text-slate-500">test1@gmail.com</span>
                </p>
              </form>
            )}

            {/* ── STEP 2: Reason + comment + option ── */}
            {step === "details" && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <StepBadge step="2" label="Return details" />

                {/* Return reason */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">
                    Return Reason
                  </label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 16px center",
                    }}
                  >
                    <option value="">Select return reason</option>
                    <option value="wrong_size">Wrong size</option>
                    <option value="damaged_item">Damaged item</option>
                    <option value="changed_mind">Changed mind</option>
                    <option value="late_delivery">Late delivery</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Customer comment */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">
                    Tell us more about the issue
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Describe what happened with your order…"
                    rows={3}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 resize-none"
                  />
                </div>
                {/* Proof image upload */}
<div className="space-y-2">
  <label className="block text-sm font-semibold text-slate-700">
    Upload Proof Image <span className="text-slate-400 font-normal">(optional)</span>
  </label>

  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all duration-150">
    <div className="flex flex-col items-center justify-center gap-1 text-slate-400">
      <span className="text-2xl">📷</span>
      <span className="text-xs font-medium">Click to upload a photo</span>
      <span className="text-[11px]">JPG, PNG, WEBP — max 5 MB</span>
    </div>
    <input
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleImageChange}
    />
  </label>

  {/* Preview */}
  {imagePreview && (
    <div className="relative mt-1">
      <img
        src={imagePreview}
        alt="Proof preview"
        className="w-full max-h-48 object-contain rounded-xl border border-slate-200 bg-slate-50"
      />
      <button
        type="button"
        onClick={() => { setImagePreview(""); setProofImage(""); }}
        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center hover:bg-red-600 transition-colors"
      >
        ✕
      </button>
    </div>
  )}
</div>

                {/* Offer ladder */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700 mb-1">
                    Preferred Resolution
                  </p>
                  {[
                    { label: "Exchange Product", icon: "🔄", desc: "Swap for a different size or colour" },
                    { label: "Store Credit",     icon: "💳", desc: "Credit added to your account instantly" },
                    { label: "Partial Refund",   icon: "💸", desc: "Keep the item, get money back" },
                    { label: "Manual Review",    icon: "🔎", desc: "Our team will personally investigate" },
                  ].map(({ label, icon, desc }) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => setSelectedOption(label)}
                      className={`w-full border rounded-xl px-4 py-3.5 text-left transition-all duration-150 flex items-center gap-3
                        ${selectedOption === label
                          ? "border-slate-800 bg-slate-800 text-white shadow-md shadow-slate-800/20"
                          : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50 text-slate-700"
                        }`}
                    >
                      <span className="text-lg leading-none">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold leading-tight ${selectedOption === label ? "text-white" : "text-slate-800"}`}>
                          {label}
                        </p>
                        <p className={`text-xs mt-0.5 ${selectedOption === label ? "text-slate-300" : "text-slate-400"}`}>
                          {desc}
                        </p>
                      </div>
                      {selectedOption === label && (
                        <span className="text-white text-sm font-bold ml-auto">✓</span>
                      )}
                    </button>
                  ))}
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm shadow-md shadow-slate-800/20"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>Submit Request to Merchant <span className="opacity-70">→</span></>
                  )}
                </button>
              </form>
            )}

            {/* ── STEP 3: Confirmation ── */}
            {step === "confirm" && (
              <div className="space-y-5">
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center text-lg flex-shrink-0 mt-0.5">
                    ✅
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-800">
                      Request submitted successfully
                    </p>
                    <p className="text-xs text-emerald-600 mt-1 leading-relaxed">
                      The merchant will review your request and get back to you
                      via email. Your preferred option was{" "}
                      <span className="font-semibold">{selectedOption}</span>.
                    </p>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order</span>
                    <span className="font-semibold text-slate-800">#{orderNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email</span>
                    <span className="font-semibold text-slate-800 truncate max-w-[180px]">{email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reason</span>
                    <span className="font-semibold text-slate-800 capitalize">{reason.replace("_", " ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Preferred option</span>
                    <span className="font-semibold text-slate-800">{selectedOption}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <button
                    onClick={handleReset}
                    className="w-full py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] text-slate-600 hover:text-slate-800 text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 group"
                  >
                    <span className="group-hover:-translate-x-0.5 transition-transform duration-150">←</span>
                    Check Another Return
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          Need help?{" "}
          <a href="#" className="underline hover:text-slate-600 transition-colors">
            Contact support
          </a>
        </p>
      </div>
    </main>
  );
}