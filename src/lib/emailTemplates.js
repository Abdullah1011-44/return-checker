const ACTION_MESSAGES = {
  APPROVE: "Your return request has been approved.",
  REJECT: "Your return request could not be approved at this time.",
  NEEDS_MORE_INFO:
    "We need a little more information before we can continue with your return request.",
  RESOLVE: "Your return request has been resolved.",
};

function escapeHtml(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatOrderNumber(orderNumber) {
  const raw = String(orderNumber ?? "").replace(/^#/, "").trim();
  return raw || "your order";
}

function buildSubject(action, orderNumber) {
  const orderLabel = formatOrderNumber(orderNumber);

  switch (action) {
    case "APPROVE":
      return `Your return request for Order #${orderLabel} has been approved`;
    case "REJECT":
      return `Update on your return request for Order #${orderLabel}`;
    case "NEEDS_MORE_INFO":
      return "More information needed for your return request";
    case "RESOLVE":
      return `Your return request for Order #${orderLabel} has been resolved`;
    default:
      return `Update on your return request for Order #${orderLabel}`;
  }
}

function formatItemsList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "No item details available.";
  }

  return items
    .map((item) => {
      const title = item?.title || item?.productName || "Item";
      const sku = item?.sku ? ` (SKU: ${item.sku})` : "";
      const qty =
        item?.quantity != null ? ` — Qty: ${item.quantity}` : "";
      return `- ${title}${sku}${qty}`;
    })
    .join("\n");
}

function formatItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "<p>No item details available.</p>";
  }

  const rows = items
    .map((item) => {
      const title = escapeHtml(item?.title || item?.productName || "Item");
      const sku = item?.sku
        ? ` <span style="color:#64748b;">(SKU: ${escapeHtml(item.sku)})</span>`
        : "";
      const qty =
        item?.quantity != null
          ? ` <span style="color:#64748b;">Qty: ${escapeHtml(item.quantity)}</span>`
          : "";
      return `<li>${title}${sku}${qty}</li>`;
    })
    .join("");

  return `<ul style="padding-left:20px;margin:12px 0;">${rows}</ul>`;
}

/**
 * Build subject/html/text for merchant return status notifications.
 */
export function buildReturnStatusEmail({
  customerEmail,
  orderNumber,
  merchantName,
  status,
  action,
  merchantNote,
  items = [],
}) {
  const safeAction = ACTION_MESSAGES[action] ? action : "APPROVE";
  const orderLabel = formatOrderNumber(orderNumber);
  const storeName = merchantName?.trim() || "your store";
  const statusMessage =
    ACTION_MESSAGES[safeAction] ?? ACTION_MESSAGES.APPROVE;
  const note = merchantNote?.trim() || "";
  const subject = buildSubject(safeAction, orderNumber);

  const itemsText = formatItemsList(items);
  const noteText = note ? `\n\nMessage from ${storeName}:\n${note}` : "";
  const noteHtml = note
    ? `<p style="margin:16px 0 0;"><strong>Message from ${escapeHtml(storeName)}:</strong><br>${escapeHtml(note).replace(/\n/g, "<br>")}</p>`
    : "";

  const text = [
    `Hello,`,
    ``,
    statusMessage,
    ``,
    `Order: #${orderLabel}`,
    `Store: ${storeName}`,
    status ? `Status: ${status}` : null,
    ``,
    `Items:`,
    itemsText,
    noteText,
    ``,
    `Thank you,`,
    storeName,
  ]
    .filter((line) => line != null)
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;max-width:600px;margin:0 auto;padding:24px;">
    <p>Hello,</p>
    <p>${escapeHtml(statusMessage)}</p>
    <p><strong>Order:</strong> #${escapeHtml(orderLabel)}<br>
    <strong>Store:</strong> ${escapeHtml(storeName)}${
      status
        ? `<br><strong>Status:</strong> ${escapeHtml(status)}`
        : ""
    }</p>
    <p><strong>Items:</strong></p>
    ${formatItemsHtml(items)}
    ${noteHtml}
    <p style="margin-top:24px;">Thank you,<br>${escapeHtml(storeName)}</p>
  </body>
</html>`;

  return {
    subject,
    html,
    text,
  };
}
