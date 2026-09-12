'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IS_CONNECTED } from '@/lib/config';

/**
 * Top-level nav. Deliberately small: a switch between Review and History, and
 * the liveness pill. The design spec calls for no deep nav tree.
 *
 * The pill reports whether a worker is connected, not whether anything is
 * healthy — that finer distinction belongs on /status, backed by the real
 * watchdog once it exists. Claiming "Live" without a worker behind it would be
 * exactly the kind of unearned confidence this product avoids.
 */
export function Nav() {
  const pathname = usePathname();

  const isReview = pathname === '/' || pathname.startsWith('/review');
  const isHistory = pathname.startsWith('/history');
  const isStatus = pathname.startsWith('/status');

  return (
    <nav className="nav" aria-label="Primary">
      <div className="shell nav__inner">
        <Link href="/" className="nav__brand">
          Observed
        </Link>

        <div className="nav__right">
          <div className="nav__links">
            <Link
              href="/"
              className={isReview ? 'navlink navlink--active' : 'navlink'}
              aria-current={isReview ? 'page' : undefined}
            >
              Review
            </Link>
            <Link
              href="/history"
              className={isHistory ? 'navlink navlink--active' : 'navlink'}
              aria-current={isHistory ? 'page' : undefined}
            >
              History
            </Link>
            <Link
              href="/status"
              className={isStatus ? 'navlink navlink--active' : 'navlink'}
              aria-current={isStatus ? 'page' : undefined}
            >
              Status
            </Link>
          </div>

          <span className="livepill">
            <span
              className={
                IS_CONNECTED
                  ? 'livepill__dot'
                  : 'livepill__dot livepill__dot--stopped'
              }
            />
            {IS_CONNECTED ? 'Live' : 'Not connected'}
          </span>
        </div>
      </div>
    </nav>
  );
}
