import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow root path only - redirect everything else
  if (pathname === '/') {
    return NextResponse.next();
  }

  // Redirect all other routes to home page
  return NextResponse.redirect(new URL('/', request.url));
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api routes
     * - _next (Next.js internals)
     * - static files
     */
    '/((?!api|_next|.*\\..*).*)',
  ],
};
