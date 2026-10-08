'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Locale } from '@/lib/i18n';
import type { Workspace } from '@/lib/me';

/**
 * task.md § 2.2: the switcher appears whenever a person has more than one
 * workspace — and only then. A person who is just a parent should never see a
 * control implying there is somewhere else to be.
 *
 * `PUT /api/me/workspace` records the choice so the next `/dashboard` lands in
 * the same place; the API rejects a workspace the actor does not hold, so a
 * stale tab cannot park someone where they will be bounced from.
 */
export function WorkspaceSwitcher({
  locale,
  current,
  workspaces,
  labels,
  groupLabel,
}: {
  locale: Locale;
  current: Workspace;
  workspaces: Workspace[];
  labels: Record<Workspace, string>;
  groupLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Workspace | null>(null);

  if (workspaces.length < 2) return null;

  const go = (workspace: Workspace): void => {
    if (workspace === current || pending) return;
    setTarget(workspace);
    startTransition(async () => {
      try {
        await fetch('/api/me/workspace', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace }),
        });
      } catch {
        // Navigate anyway: the preference is a convenience, and the destination
        // layout re-checks the workspace server-side.
      }
      router.push(`/${locale}/${workspace}`);
      router.refresh();
    });
  };

  return (
    <div className="ws__switch" role="group" aria-label={groupLabel}>
      {workspaces.map((workspace) => (
        <button
          key={workspace}
          type="button"
          className="ws__switchBtn"
          aria-pressed={workspace === current}
          disabled={pending && target !== workspace}
          onClick={() => go(workspace)}
        >
          {labels[workspace]}
        </button>
      ))}
    </div>
  );
}
