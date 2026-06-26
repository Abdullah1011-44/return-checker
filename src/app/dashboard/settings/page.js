"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { STORE_TYPES } from "@/lib/merchantSettings";

const STORE_TYPE_LABELS = {
  GENERAL: "General retail",
  FASHION: "Fashion & apparel",
  ELECTRONICS: "Electronics",
  BEAUTY: "Beauty & cosmetics",
  HOME: "Home & living",
  FOOD: "Food & beverage",
  OTHER: "Other",
};

const RECOVERY_TOGGLES = [
  {
    key: "allowExchange",
    label: "Allow exchanges",
    description: "Customers can request a product exchange.",
  },
  {
    key: "allowStoreCredit",
    label: "Allow store credit",
    description: "Offer store credit as a recovery option.",
  },
  {
    key: "allowPartialRefund",
    label: "Allow partial refunds",
    description: "Offer partial refunds for eligible returns.",
  },
  {
    key: "allowKeepItem",
    label: "Allow keep-item offers",
    description: "Let customers keep the item with a discount.",
  },
  {
    key: "freeExchangeShipping",
    label: "Free exchange shipping",
    description: "Cover outbound shipping on approved exchanges.",
  },
];

const EMPTY_FORM = {
  notifyEmail: "",
  returnWindow: "30",
  autoRejectDays: "",
  aiConfidence: 0.7,
  storeType: "GENERAL",
  allowExchange: true,
  allowKeepItem: false,
  allowPartialRefund: true,
  allowStoreCredit: true,
  freeExchangeShipping: false,
};

const pageShellStyle = {
  backgroundColor: "#f8fafc",
  backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};

function settingsToForm(settings) {
  return {
    notifyEmail: settings.notifyEmail ?? "",
    returnWindow: String(settings.returnWindow ?? 30),
    autoRejectDays:
      settings.autoRejectDays == null ? "" : String(settings.autoRejectDays),
    aiConfidence:
      typeof settings.aiConfidence === "number" ? settings.aiConfidence : 0.7,
    storeType: settings.storeType ?? "GENERAL",
    allowExchange: Boolean(settings.allowExchange),
    allowKeepItem: Boolean(settings.allowKeepItem),
    allowPartialRefund: Boolean(settings.allowPartialRefund),
    allowStoreCredit: Boolean(settings.allowStoreCredit),
    freeExchangeShipping: Boolean(settings.freeExchangeShipping),
  };
}

function isValidEmail(value) {
  if (!value || !value.trim()) {
    return true;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validateSettingsForm(form) {
  const errors = {};

  const returnWindow = Number.parseInt(form.returnWindow, 10);
  if (!Number.isFinite(returnWindow) || returnWindow <= 0) {
    errors.returnWindow = "Return window must be greater than 0.";
  }

  const autoRejectRaw = form.autoRejectDays.trim();
  if (autoRejectRaw) {
    const autoRejectDays = Number.parseInt(autoRejectRaw, 10);
    if (!Number.isFinite(autoRejectDays) || autoRejectDays <= 0) {
      errors.autoRejectDays =
        "Auto-reject days must be empty or greater than 0.";
    }
  }

  if (
    typeof form.aiConfidence !== "number" ||
    Number.isNaN(form.aiConfidence) ||
    form.aiConfidence < 0 ||
    form.aiConfidence > 1
  ) {
    errors.aiConfidence = "AI confidence must be between 0% and 100%.";
  }

  if (!isValidEmail(form.notifyEmail)) {
    errors.notifyEmail = "Enter a valid notification email or leave blank.";
  }

  if (!STORE_TYPES.includes(form.storeType)) {
    errors.storeType = "Select a valid store type.";
  }

  return errors;
}

function formToPayload(form) {
  const autoRejectRaw = form.autoRejectDays.trim();

  return {
    notifyEmail: form.notifyEmail.trim() ? form.notifyEmail.trim() : null,
    returnWindow: Number.parseInt(form.returnWindow, 10),
    autoRejectDays: autoRejectRaw ? Number.parseInt(autoRejectRaw, 10) : null,
    aiConfidence: Number(form.aiConfidence),
    storeType: form.storeType,
    allowExchange: form.allowExchange,
    allowKeepItem: form.allowKeepItem,
    allowPartialRefund: form.allowPartialRefund,
    allowStoreCredit: form.allowStoreCredit,
    freeExchangeShipping: form.freeExchangeShipping,
  };
}

function SectionCard({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {description
          ? <p className="text-xs text-slate-500 mt-1">{description}</p>
          : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldLabel({ htmlFor, label, hint }) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold text-slate-700"
      >
        {label}
      </label>
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function FieldError({ message }) {
  if (!message) {
    return null;
  }

  return <p className="text-xs text-red-600 mt-1">{message}</p>;
}

function TextInput({ id, value, onChange, type = "text", placeholder, error }) {
  return (
    <>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1 ${
          error ? "border-red-300" : "border-slate-200"
        }`}
      />
      <FieldError message={error} />
    </>
  );
}

function ToggleRow({ id, label, description, checked, onChange }) {
  return (
    <label
      htmlFor={id}
      className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 cursor-pointer"
    >
      <span>
        <span className="block text-sm font-medium text-slate-800">
          {label}
        </span>
        {description
          ? <span className="block text-xs text-slate-500 mt-0.5">
              {description}
            </span>
          : null}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
      />
    </label>
  );
}

export default function MerchantSettingsPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setSaveSuccess("");

    try {
      const res = await fetch("/api/settings", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success !== true || !data.settings) {
        setLoadError(
          data.message ||
            data.error ||
            (res.status === 401
              ? "Please sign in to manage settings."
              : "Unable to load merchant settings."),
        );
        return;
      }

      setForm(settingsToForm(data.settings));
      setUpdatedAt(data.settings.updatedAt ?? null);
      setFieldErrors({});
    } catch {
      setLoadError("Unable to load merchant settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setSaveSuccess("");
    setSaveError("");
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaveError("");
    setSaveSuccess("");

    const errors = validateSettingsForm(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSaveError("Fix the highlighted fields before saving.");
      return;
    }

    setFieldErrors({});
    setSaving(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formToPayload(form)),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success !== true || !data.settings) {
        const detailMessage = Array.isArray(data.details)
          ? data.details
              .map((item) => item.message)
              .filter(Boolean)
              .join(" ")
          : "";

        setSaveError(
          detailMessage ||
            data.error ||
            data.message ||
            "Unable to save settings.",
        );
        return;
      }

      setForm(settingsToForm(data.settings));
      setUpdatedAt(data.settings.updatedAt ?? null);
      setSaveSuccess("Settings saved successfully.");
    } catch {
      setSaveError("Unable to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const aiConfidencePercent = Math.round(form.aiConfidence * 100);

  return (
    <main className="min-h-screen px-4 py-10" style={pageShellStyle}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Return Recovery Copilot
            </p>
            <h1 className="text-2xl font-bold text-slate-900">
              Merchant Settings
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Configure returns, recovery rules, and notifications
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/dashboard"
              className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-full px-4 py-2 shadow-sm transition-all duration-150"
            >
              Back to Dashboard
            </Link>
            {updatedAt
              ? <span className="text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
                  Updated {new Date(updatedAt).toLocaleString()}
                </span>
              : null}
          </div>
        </div>

        {loading && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-sm font-medium">Loading settings…</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 inline-block">
              {loadError}
            </p>
          </div>
        )}

        {!loading && !loadError && (
          <form onSubmit={handleSave} className="space-y-6">
            {(saveSuccess || saveError) && (
              <div className="space-y-2">
                {saveSuccess && (
                  <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    {saveSuccess}
                  </p>
                )}
                {saveError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    {saveError}
                  </p>
                )}
              </div>
            )}

            <SectionCard
              title="Store"
              description="Helps tailor recovery recommendations to your catalog."
            >
              <div>
                <FieldLabel
                  htmlFor="storeType"
                  label="Store type"
                  hint="Used for AI and recovery defaults."
                />
                <select
                  id="storeType"
                  value={form.storeType}
                  onChange={(event) =>
                    updateField("storeType", event.target.value)
                  }
                  className={`mt-2 w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1 ${
                    fieldErrors.storeType
                      ? "border-red-300"
                      : "border-slate-200"
                  }`}
                >
                  {STORE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {STORE_TYPE_LABELS[type] ?? type}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.storeType} />
              </div>
            </SectionCard>

            <SectionCard
              title="Returns"
              description="Control how long customers can submit returns."
            >
              <div>
                <FieldLabel
                  htmlFor="returnWindow"
                  label="Return window (days)"
                  hint="Must be greater than 0."
                />
                <TextInput
                  id="returnWindow"
                  type="number"
                  min="1"
                  value={form.returnWindow}
                  onChange={(event) =>
                    updateField("returnWindow", event.target.value)
                  }
                  error={fieldErrors.returnWindow}
                />
              </div>

              <div>
                <FieldLabel
                  htmlFor="autoRejectDays"
                  label="Auto-reject after (days)"
                  hint="Leave empty to disable automatic rejection."
                />
                <TextInput
                  id="autoRejectDays"
                  type="number"
                  min="1"
                  value={form.autoRejectDays}
                  onChange={(event) =>
                    updateField("autoRejectDays", event.target.value)
                  }
                  placeholder="Optional"
                  error={fieldErrors.autoRejectDays}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Recovery Rules"
              description="Choose which recovery options customers can receive."
            >
              <div className="space-y-3">
                {RECOVERY_TOGGLES.map((toggle) => (
                  <ToggleRow
                    key={toggle.key}
                    id={toggle.key}
                    label={toggle.label}
                    description={toggle.description}
                    checked={form[toggle.key]}
                    onChange={(checked) => updateField(toggle.key, checked)}
                  />
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="AI"
              description="Set how confidently the copilot recommends recovery actions."
            >
              <div>
                <div className="flex items-center justify-between gap-4">
                  <FieldLabel
                    htmlFor="aiConfidence"
                    label="AI confidence threshold"
                    hint="Higher values favor stronger automated recommendations."
                  />
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {aiConfidencePercent}%
                  </span>
                </div>
                <input
                  id="aiConfidence"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={aiConfidencePercent}
                  onChange={(event) =>
                    updateField(
                      "aiConfidence",
                      Number(event.target.value) / 100,
                    )
                  }
                  className="mt-3 w-full h-2 rounded-full appearance-none bg-slate-200 accent-slate-900 cursor-pointer"
                />
                <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  <span>0% — cautious</span>
                  <span>100% — assertive</span>
                </div>
                <FieldError message={fieldErrors.aiConfidence} />
              </div>
            </SectionCard>

            <SectionCard
              title="Notifications"
              description="Where ReturnRadar sends merchant alerts."
            >
              <div>
                <FieldLabel
                  htmlFor="notifyEmail"
                  label="Notification email"
                  hint="Leave blank to disable email alerts."
                />
                <TextInput
                  id="notifyEmail"
                  type="email"
                  value={form.notifyEmail}
                  onChange={(event) =>
                    updateField("notifyEmail", event.target.value)
                  }
                  placeholder="alerts@yourstore.com"
                  error={fieldErrors.notifyEmail}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Branding"
              description="Customer-facing appearance for your return portal."
            >
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4">
                <p className="text-sm font-medium text-slate-700">
                  Branding syncs from Shopify
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Store logo and storefront branding are pulled from your
                  Shopify theme. Custom branding controls will be available here
                  in a future update.
                </p>
              </div>
            </SectionCard>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={loadSettings}
                disabled={saving}
                className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-full px-4 py-2 shadow-sm transition-all duration-150"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed rounded-full px-5 py-2 shadow-sm transition-all duration-150"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-xs text-slate-400 mt-8">
          Powered by Return Recovery Copilot
        </p>
      </div>
    </main>
  );
}
