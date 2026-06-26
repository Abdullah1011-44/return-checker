import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  createAdminAuditLog,
  logOrderStatusUpdated,
  safeCreateAdminAuditLog,
} from "@/lib/adminAudit";
import {
  AUDIT_ACTORS,
  AUDIT_EVENTS,
  createAuditEvent,
  safeCreateAuditEvent,
} from "@/lib/audit";
import { mockPrisma } from "./helpers/mockPrisma.js";

describe("audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates expected ReturnEvent audit payload", async () => {
    const createdEvent = { id: "return-event-1" };
    mockPrisma.returnEvent.create.mockResolvedValue(createdEvent);

    const result = await createAuditEvent({
      returnRequestId: "return-request-1",
      actorType: AUDIT_ACTORS.MERCHANT,
      eventType: AUDIT_EVENTS.MERCHANT_ACTION_APPROVE,
      fromValue: "PENDING",
      toValue: "APPROVED",
      note: "Merchant approved return",
      metadata: { hasMerchantNote: true },
    });

    expect(result).toEqual(createdEvent);
    expect(mockPrisma.returnEvent.create).toHaveBeenCalledWith({
      data: {
        returnRequestId: "return-request-1",
        actorType: AUDIT_ACTORS.MERCHANT,
        eventType: AUDIT_EVENTS.MERCHANT_ACTION_APPROVE,
        fromValue: "PENDING",
        toValue: "APPROVED",
        note: "Merchant approved return",
        metadata: { hasMerchantNote: true },
      },
    });
  });

  it("includes actorType ADMIN in admin audit log when admin acts", async () => {
    const adminLog = { id: "admin-audit-1" };
    mockPrisma.adminAuditLog.create.mockResolvedValue(adminLog);

    const result = await createAdminAuditLog({
      merchantId: "merchant-admin-1",
      actorType: ADMIN_AUDIT_ACTORS.ADMIN,
      eventType: ADMIN_AUDIT_EVENTS.ADMIN_ACTION,
      message: "Admin accessed protected route",
      metadata: { routeName: "/api/admin/test" },
    });

    expect(result).toEqual(adminLog);
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "merchant-admin-1",
        actorType: ADMIN_AUDIT_ACTORS.ADMIN,
        eventType: ADMIN_AUDIT_EVENTS.ADMIN_ACTION,
        message: "Admin accessed protected route",
        metadata: { routeName: "/api/admin/test" },
      }),
    });
  });

  it("includes actorType MERCHANT in audit log when merchant acts", async () => {
    mockPrisma.returnEvent.create.mockResolvedValue({ id: "return-event-2" });

    await createAuditEvent({
      returnRequestId: "return-request-2",
      actorType: AUDIT_ACTORS.MERCHANT,
      eventType: AUDIT_EVENTS.MERCHANT_ACTION_RESOLVE,
      note: "Resolved by merchant",
    });

    expect(mockPrisma.returnEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: AUDIT_ACTORS.MERCHANT,
        eventType: AUDIT_EVENTS.MERCHANT_ACTION_RESOLVE,
        note: "Resolved by merchant",
      }),
    });
  });

  it("creates ORDER_STATUS_UPDATED admin audit log when order status changes", async () => {
    const adminLog = { id: "admin-audit-order-status" };
    mockPrisma.adminAuditLog.create.mockResolvedValue(adminLog);
    const auditInfoSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await logOrderStatusUpdated({
      merchantId: "merchant-1",
      orderId: "order-1",
      oldStatus: "PENDING",
      newStatus: "PAID",
    });

    expect(result).toEqual(adminLog);
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "merchant-1",
        actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
        eventType: ADMIN_AUDIT_EVENTS.ORDER_STATUS_UPDATED,
        resourceType: "CUSTOMER_ORDER",
        resourceId: "order-1",
        metadata: {
          merchantId: "merchant-1",
          orderId: "order-1",
          oldStatus: "PENDING",
          newStatus: "PAID",
        },
      }),
    });
    expect(auditInfoSpy).toHaveBeenCalledWith(
      `[Audit] ${AUDIT_EVENTS.ORDER_STATUS_UPDATED}`,
      {
        merchantId: "merchant-1",
        orderId: "order-1",
        oldStatus: "PENDING",
        newStatus: "PAID",
      },
    );

    auditInfoSpy.mockRestore();
  });

  it("skips ORDER_STATUS_UPDATED audit log when status is unchanged", async () => {
    const result = await logOrderStatusUpdated({
      merchantId: "merchant-1",
      orderId: "order-1",
      oldStatus: "PAID",
      newStatus: "PAID",
    });

    expect(result).toBeNull();
    expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("does not crash main action when audit persistence fails", async () => {
    mockPrisma.returnEvent.create.mockRejectedValue(
      new Error("database unavailable"),
    );
    mockPrisma.adminAuditLog.create.mockRejectedValue(
      new Error("database unavailable"),
    );

    const returnAuditWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const mainAction = vi.fn(() => ({ success: true }));

    const returnAuditResult = await safeCreateAuditEvent({
      returnRequestId: "return-request-3",
      actorType: AUDIT_ACTORS.MERCHANT,
      eventType: AUDIT_EVENTS.RETURN_SUBMITTED,
    });

    const adminAuditResult = await safeCreateAdminAuditLog({
      actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_STARTED,
      message: "Merchant started sync",
    });

    const actionResult = mainAction();

    expect(returnAuditResult).toBeNull();
    expect(adminAuditResult).toBeNull();
    expect(actionResult).toEqual({ success: true });
    expect(mainAction).toHaveBeenCalledOnce();
    expect(returnAuditWarn).toHaveBeenCalledWith(
      "[Audit] Failed to create audit event",
    );
    expect(returnAuditWarn).toHaveBeenCalledWith(
      "[AdminAudit] Failed to create admin audit log",
    );

    returnAuditWarn.mockRestore();
  });
});
