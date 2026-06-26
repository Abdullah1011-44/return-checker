import { NextResponse } from "next/server";
import {
  hasMerchantSessionCookieShape,
  MERCHANT_SESSION_COOKIE,
} from "@/lib/merchantSessionConstants";

const PROTECTED_PREFIXES = ["/dashboard", "/analytics"];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const token = request.cookies.get(MERCHANT_SESSION_COOKIE)?.value;

  if (!hasMerchantSessionCookieShape(token)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/analytics",
    "/analytics/:path*",
  ],
};
