/** Build /status URL with optional order + email query params for prefilled lookup */

export function buildStatusTrackingUrl(orderNumber, email) {
  const params = new URLSearchParams();
  const order = orderNumber?.replace?.("#", "")?.trim();
  const normalizedEmail = email?.trim();

  if (order) params.set("order", order);
  if (normalizedEmail) params.set("email", normalizedEmail);

  const qs = params.toString();
  return qs ? `/status?${qs}` : "/status";
}

export function readStatusPrefillFromSearchParams(searchParams) {
  const order =
    searchParams.get("order") ?? searchParams.get("orderNumber") ?? "";
  const email = searchParams.get("email") ?? "";
  return { orderNumber: order, email };
}
