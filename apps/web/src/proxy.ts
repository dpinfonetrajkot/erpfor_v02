import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends visitors without a session cookie straight to the login page.
 * (The API still checks every request; this only avoids a flash of the app shell.)
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has('erp2_rt')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the login page, the API proxy (and the biometric machines' /iclock), Next internals and static files.
  matcher: ['/((?!login|api|iclock|_next/static|_next/image|icon.svg|favicon.ico).*)'],
};
