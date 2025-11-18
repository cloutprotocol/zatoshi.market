import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow only root path, API routes, and static assets
  if (
    pathname === '/' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|ogg)$/i)
  ) {
    return NextResponse.next();
  }

  // Redirect all other routes to home page
  return NextResponse.redirect(new URL('/', request.url));
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/).*)',
  ],
};
