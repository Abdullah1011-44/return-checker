"use client";
import { useState } from "react";
import { addReturnRequest, buildReturnRequest } from "@/lib/returnRequests";
import { buildStatusTrackingUrl } from "@/lib/statusTrackingUrl";

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

const RESOLUTION_OPTIONS = [
  {
    label: "Exchange Product",
    icon: "🔄",
    desc: "Swap for a different size or colour",
  },
  {
    label: "Store Credit",
    icon: "💳",
    desc: "Credit added to your account instantly",
  },
  {
    label: "Partial Refund",
    icon: "💸",
    desc: "Keep the item, get money back",
  },
  {
    label: "Manual Review",
    icon: "🔎",
    desc: "Our team will personally investigate",
  },
];

function createEmptyItemDetail() {
  return {
    returnReason: "",
    comment: "",
    selectedOption: "",
    proofImageName: "",
    proofImage: "",
    imagePreview: "",
  };
}

// ── Main Page ────────────────────────────────────────────────────
export default function Home() {
  // Step: "check" | "items" | "details" | "confirm"
  const [step, setStep] = useState("check");

  // Step 1 fields
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");

  // Order + item selection (after verification)
  const [orderData, setOrderData] = useState(null);
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [itemDetails, setItemDetails] = useState({});
  const [submittedItems, setSubmittedItems] = useState([]);

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

      if (data.orderFound) {
        setOrderData(data);
        setSelectedItemIds([]);
        setStep("items");
      } else {
        setError(
          data.message ||
            "Order not found. Please check your order number and email.",
        );
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggleItemSelection(item) {
    if (!item.eligible || item.alreadyReturnRequested) return;
    setSelectedItemIds((prev) =>
      prev.includes(item.id)
        ? prev.filter((id) => id !== item.id)
        : [...prev, item.id],
    );
  }

  function handleContinueToDetails() {
    if (selectedItemIds.length === 0) {
      setError("Please select at least one eligible item to continue.");
      return;
    }
    const initial = {};
    for (const id of selectedItemIds) {
      initial[id] = createEmptyItemDetail();
    }
    setItemDetails(initial);
    setError("");
    setStep("details");
  }

  function updateItemDetail(itemId, field, value) {
    setItemDetails((prev) => ({
      ...prev,
      [itemId]: {
        ...createEmptyItemDetail(),
        ...prev[itemId],
        [field]: value,
      },
    }));
  }

  function handleItemImageChange(itemId, e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const preview = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      setItemDetails((prev) => ({
        ...prev,
        [itemId]: {
          ...createEmptyItemDetail(),
          ...prev[itemId],
          proofImageName: file.name,
          proofImage: dataUrl,
          imagePreview: preview,
        },
      }));
    };
    reader.readAsDataURL(file);
  }

  function clearItemImage(itemId) {
    setItemDetails((prev) => {
      const existing = prev[itemId];
      if (existing?.imagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(existing.imagePreview);
      }
      return {
        ...prev,
        [itemId]: {
          ...createEmptyItemDetail(),
          ...prev[itemId],
          proofImageName: "",
          proofImage: "",
          imagePreview: "",
        },
      };
    });
  }

  function getSelectedOrderItems() {
    return (orderData?.items || []).filter((item) =>
      selectedItemIds.includes(item.id),
    );
  }

  // ── Step 3: Submit final request ───────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (selectedItemIds.length === 0) {
      setError("Please select at least one item.");
      return;
    }

    const selectedItems = getSelectedOrderItems();
    for (const item of selectedItems) {
      const details = itemDetails[item.id] || createEmptyItemDetail();
      if (!details.returnReason) {
        setError(`Please select a return reason for ${item.title}.`);
        return;
      }
      if (!details.selectedOption) {
        setError(`Please select a preferred resolution for ${item.title}.`);
        return;
      }
    }

    setError("");
    setLoading(true);

    const returnRequestItems = selectedItems.map((item) => {
      const details = itemDetails[item.id] || createEmptyItemDetail();
      return {
        itemId: item.id,
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
        price: item.price,
        returnReason: details.returnReason,
        comment: details.comment,
        selectedOption: details.selectedOption,
        proofImageName: details.proofImageName,
        proofImage: details.proofImage,
      };
    });

    try {
      const res = await fetch("/api/submit-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, email, returnRequestItems }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 409 && data.error === "DUPLICATE_RETURN_REQUEST") {
          const duplicateTitles = (data.duplicateItems || [])
            .map((item) => item.title || item.sku || item.orderItemId)
            .filter(Boolean)
            .join(", ");
          setError(
            duplicateTitles
              ? `Return already requested for: ${duplicateTitles}`
              : data.message ||
                  "One or more selected items already have an active return request.",
          );
          return;
        }

        if (data.error === "DUPLICATE_ITEM_IDS_IN_REQUEST") {
          setError(
            data.message ||
              "The same item cannot be submitted more than once in a single request.",
          );
          return;
        }

        setError(data.message || "Something went wrong. Please try again.");
        return;
      }

      const newRequest = buildReturnRequest({
        orderNumber,
        email,
        returnRequestItems,
      });
      addReturnRequest(newRequest);

      setSubmittedItems(returnRequestItems);
      setStep("confirm");
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
    setOrderData(null);
    setSelectedItemIds([]);
    setItemDetails({});
    setSubmittedItems([]);
    setError("");
  }

  const reasonLabels = {
    wrong_size: "Wrong size",
    damaged_item: "Damaged item",
    changed_mind: "Changed mind",
    late_delivery: "Late delivery",
    other: "Other",
  };

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        backgroundColor: "#f8fafc",
        backgroundImage:
          "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className={`w-full ${step === "details" ? "max-w-lg" : "max-w-md"}`}>
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/80 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-8 py-6 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute -right-2 -bottom-8 w-16 h-16 rounded-full bg-white/5 pointer-events-none" />
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1 relative z-10">
              Return Recovery Copilot
            </p>
            <h1 className="text-white text-2xl font-bold tracking-tight relative z-10">
              {step === "check" && "Returns Portal"}
              {step === "items" && "Select Items"}
              {step === "details" && "Tell Us More"}
              {step === "confirm" && "Request Submitted"}
            </h1>
            {step === "check" && (
              <p className="text-slate-300 text-sm mt-2 relative z-10 leading-relaxed">
                Exchange, return, or track an existing request.
              </p>
            )}
          </div>

          <div className="px-8 py-8">
            {/* ── STEP 1: Order lookup ── */}
            {step === "check" && (
              <form onSubmit={handleCheck} className="space-y-5">
                <StepBadge step="1" label="Verify your order" />

                <div className="space-y-1.5">
                  <label
                    htmlFor="orderNumber"
                    className="block text-sm font-semibold text-slate-700"
                  >
                    Order Number
                  </label>
                  <input
                    id="orderNumber"
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
                  <label
                    htmlFor="email"
                    className="block text-sm font-semibold text-slate-700"
                  >
                    Email Address
                  </label>
                  <input
                    id="email"
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
                  {loading
                    ? <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Checking…
                      </>
                    : <>
                        Check Return Eligibility{" "}
                        <span className="opacity-70">→</span>
                      </>}
                </button>

                <p className="text-center text-xs text-slate-400 pt-1">
                  Try orders{" "}
                  <span className="font-medium text-slate-500">1001</span> /{" "}
                  <span className="font-medium text-slate-500">
                    test1@gmail.com
                  </span>{" "}
                  or <span className="font-medium text-slate-500">1002</span> /{" "}
                  <span className="font-medium text-slate-500">
                    test2@gmail.com
                  </span>{" "}
                  (mixed eligibility)
                </p>
              </form>
            )}

            {/* ── STEP 1b: Select eligible items ── */}
            {step === "items" && orderData && (
              <div className="space-y-5">
                <StepBadge step="2" label="Select items to return" />

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-semibold text-emerald-800">
                    Order found
                  </p>
                  <p className="text-xs text-emerald-700 mt-1">
                    Order #{orderData.orderNumber} · {orderData.customerEmail}
                  </p>
                </div>

                <p className="text-sm text-slate-600">
                  Select the items you want to return. Only eligible items can
                  be selected.
                </p>

                <div className="space-y-3">
                  {orderData.items.map((item) => {
                    const isSelected = selectedItemIds.includes(item.id);

                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!item.eligible}
                        onClick={() => toggleItemSelection(item)}
                        className={`w-full text-left border rounded-xl p-4 transition-all duration-150
                          ${
                            !item.eligible
                              ? "border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed"
                              : isSelected
                                ? "border-slate-800 bg-slate-800 text-white shadow-md shadow-slate-800/20"
                                : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50"
                          }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold ${isSelected ? "text-white" : "text-slate-800"}`}
                            >
                              {item.title}
                            </p>
                            <p
                              className={`text-xs mt-1 ${isSelected ? "text-slate-300" : "text-slate-500"}`}
                            >
                              SKU: {item.sku} · Qty: {item.quantity} · $
                              {item.price.toFixed(2)}
                            </p>
                            {!item.eligible && item.ineligibleReason && (
                              <p className="text-xs text-red-600 mt-2 font-medium">
                                {item.duplicateReturnMessage ||
                                  item.ineligibleReason}
                              </p>
                            )}
                          </div>
                          {item.eligible
                            ? <span
                                className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0
                                ${
                                  isSelected
                                    ? "bg-white/20 text-white"
                                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                }`}
                              >
                                {isSelected ? "Selected" : "Eligible"}
                              </span>
                            : <span className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 bg-red-50 text-red-700 border border-red-200">
                                {item.alreadyReturnRequested
                                  ? "Return requested"
                                  : "Not eligible"}
                              </span>}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {!orderData.orderEligible && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    None of the items in this order are eligible for return.
                  </p>
                )}

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleContinueToDetails}
                  disabled={selectedItemIds.length === 0}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm shadow-md shadow-slate-800/20"
                >
                  Continue with {selectedItemIds.length || 0} item
                  {selectedItemIds.length === 1 ? "" : "s"}{" "}
                  <span className="opacity-70">→</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("check");
                    setOrderData(null);
                    setSelectedItemIds([]);
                    setError("");
                  }}
                  className="w-full py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  ← Back to order lookup
                </button>
              </div>
            )}

            {/* ── STEP 3: Per-item return details ── */}
            {step === "details" && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <StepBadge step="3" label="Return details per item" />

                <p className="text-sm text-slate-600">
                  Provide return details separately for each selected product.
                </p>

                {getSelectedOrderItems().map((item) => {
                  const details =
                    itemDetails[item.id] || createEmptyItemDetail();
                  const reasonId = `return-reason-${item.id}`;
                  const commentId = `return-comment-${item.id}`;
                  const proofId = `proof-image-${item.id}`;

                  return (
                    <div
                      key={item.id}
                      className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {item.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          SKU: {item.sku} · Qty: {item.quantity} · $
                          {item.price.toFixed(2)}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label
                          htmlFor={reasonId}
                          className="block text-sm font-semibold text-slate-700"
                        >
                          Return Reason
                        </label>
                        <select
                          id={reasonId}
                          value={details.returnReason}
                          onChange={(e) =>
                            updateItemDetail(
                              item.id,
                              "returnReason",
                              e.target.value,
                            )
                          }
                          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 appearance-none cursor-pointer"
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

                      <div className="space-y-1.5">
                        <label
                          htmlFor={commentId}
                          className="block text-sm font-semibold text-slate-700"
                        >
                          Tell us more about this item
                        </label>
                        <textarea
                          id={commentId}
                          value={details.comment}
                          onChange={(e) =>
                            updateItemDetail(item.id, "comment", e.target.value)
                          }
                          placeholder="Describe what happened with this product…"
                          rows={2}
                          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all duration-150 resize-none"
                        />
                      </div>

                      <div className="space-y-2">
                        <label
                          htmlFor={proofId}
                          className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer bg-white hover:bg-slate-100 hover:border-slate-300 transition-all duration-150"
                        >
                          <span className="block text-sm font-semibold text-slate-700 mb-2 self-start px-1">
                            Upload Proof Image{" "}
                            <span className="text-slate-400 font-normal">
                              (optional)
                            </span>
                          </span>
                          <div className="flex flex-col items-center justify-center gap-1 text-slate-400">
                            <span className="text-xl">📷</span>
                            <span className="text-xs font-medium">
                              {details.proofImageName ||
                                "Click to upload a photo"}
                            </span>
                          </div>
                          <input
                            id={proofId}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleItemImageChange(item.id, e)}
                          />
                        </label>
                        {details.imagePreview && (
                          <div className="relative mt-1">
                            {/* biome-ignore lint/performance/noImgElement: User-uploaded proof image preview; Next Image remote config is not available yet. */}
                            <img
                              src={details.imagePreview}
                              alt="Proof preview"
                              className="w-full max-h-40 object-contain rounded-xl border border-slate-200 bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => clearItemImage(item.id)}
                              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center hover:bg-red-600 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-700">
                          Preferred Resolution
                        </p>
                        {RESOLUTION_OPTIONS.map(({ label, icon, desc }) => (
                          <button
                            type="button"
                            key={`${item.id}-${label}`}
                            onClick={() =>
                              updateItemDetail(item.id, "selectedOption", label)
                            }
                            className={`w-full border rounded-xl px-4 py-3 text-left transition-all duration-150 flex items-center gap-3
                              ${
                                details.selectedOption === label
                                  ? "border-slate-800 bg-slate-800 text-white shadow-md shadow-slate-800/20"
                                  : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50 text-slate-700"
                              }`}
                          >
                            <span className="text-lg leading-none">{icon}</span>
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-sm font-semibold leading-tight ${details.selectedOption === label ? "text-white" : "text-slate-800"}`}
                              >
                                {label}
                              </p>
                              <p
                                className={`text-xs mt-0.5 ${details.selectedOption === label ? "text-slate-300" : "text-slate-400"}`}
                              >
                                {desc}
                              </p>
                            </div>
                            {details.selectedOption === label && (
                              <span className="text-white text-sm font-bold ml-auto">
                                ✓
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

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
                  {loading
                    ? <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Submitting…
                      </>
                    : <>
                        Submit Return Request{" "}
                        <span className="opacity-70">→</span>
                      </>}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("items");
                    setError("");
                  }}
                  className="w-full py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  ← Back to item selection
                </button>
              </form>
            )}

            {/* ── STEP 4: Confirmation ── */}
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
                      The merchant will review your return request and contact
                      you by email.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order</span>
                    <span className="font-semibold text-slate-800">
                      #{orderNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email</span>
                    <span className="font-semibold text-slate-800 truncate max-w-[180px]">
                      {email}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Items returned</span>
                    <span className="font-semibold text-slate-800">
                      {submittedItems.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {submittedItems.map((item) => (
                    <div
                      key={item.itemId}
                      className="rounded-xl border border-slate-200 bg-white p-4 text-sm space-y-1"
                    >
                      <p className="font-semibold text-slate-800">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        SKU: {item.sku} · Qty: {item.quantity} · $
                        {item.price.toFixed(2)}
                      </p>
                      <p className="text-xs text-slate-600">
                        Reason:{" "}
                        {reasonLabels[item.returnReason] ?? item.returnReason}
                      </p>
                      <p className="text-xs text-slate-600">
                        Resolution: {item.selectedOption}
                      </p>
                      {item.proofImageName && (
                        <p className="text-xs text-slate-500">
                          Proof: {item.proofImageName}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-100 pt-4 space-y-2">
                  <a
                    href={buildStatusTrackingUrl(orderNumber, email)}
                    className="w-full py-3 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 active:scale-[0.98] text-slate-700 text-sm font-semibold transition-all duration-150 flex items-center justify-center"
                  >
                    Track Return Status →
                  </a>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] text-slate-600 hover:text-slate-800 text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 group"
                  >
                    <span className="group-hover:-translate-x-0.5 transition-transform duration-150">
                      ←
                    </span>
                    Check Another Return
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          Already submitted a return?{" "}
          <a
            href="/status"
            className="underline hover:text-slate-600 transition-colors"
          >
            Track Return Status
          </a>
          {" · "}
          Need help?{" "}
          <button
            type="button"
            className="underline hover:text-slate-600 transition-colors"
          >
            Contact support
          </button>
        </p>
      </div>
    </main>
  );
}
