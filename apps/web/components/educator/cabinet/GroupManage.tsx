'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { useAnnounce } from '@/components/staff/review/live';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { VisibleChild } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { errorText } from './errors';
import { gradeName } from './labels';

/**
 * Group management under the overview: rename, members in/out, archive.
 * Only children the educator can already see can be placed, and a group with
 * a grade takes only that grade (the API skips the rest and says how many).
 */
export function GroupManage({
  locale,
  group,
  members,
  candidates,
}: {
  locale: Locale;
  group: { id: string; name: string; grade: number | null };
  members: VisibleChild[];
  candidates: VisibleChild[];
}) {
  const m = educatorMessages(locale);
  const t = m.manage;
  const router = useRouter();
  const announce = useAnnounce();
  const id = useId();

  const [name, setName] = useState(group.name);
  const [renameMsg, setRenameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [memberErr, setMemberErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveErr, setArchiveErr] = useState<string | null>(null);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setRenameMsg({ ok: false, text: m.create.nameRequired });
    if (clean.length > 80) return setRenameMsg({ ok: false, text: m.create.nameTooLong });
    setBusy('rename');
    try {
      await educatorApi.updateGroup(group.id, { name: clean });
      setRenameMsg({ ok: true, text: t.renamed });
      announce(t.renamed);
      router.refresh();
    } catch (err) {
      setRenameMsg({ ok: false, text: errorText(err, m, { NAME_REQUIRED: m.create.nameRequired }) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(child: VisibleChild) {
    setBusy(`rm-${child.id}`);
    setMemberErr(null);
    try {
      await educatorApi.removeMember(group.id, child.id);
      announce(fill(t.removed, { name: child.name }));
      router.refresh();
    } catch (err) {
      setMemberErr(errorText(err, m));
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (picked.size === 0) return setAddMsg({ ok: false, text: t.addPickOne });
    setBusy('add');
    try {
      const res = await educatorApi.addMembers(group.id, [...picked]);
      const text = [fill(t.added, { n: res.added }), res.skipped > 0 ? fill(t.skipped, { n: res.skipped }) : '']
        .filter(Boolean)
        .join(' ');
      setAddMsg({ ok: res.added > 0, text });
      announce(text);
      setPicked(new Set());
      router.refresh();
    } catch (err) {
      setAddMsg({ ok: false, text: errorText(err, m) });
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    setBusy('archive');
    setArchiveErr(null);
    try {
      await educatorApi.updateGroup(group.id, { archived: true });
      // /educator opens the next group, or the "no groups" state.
      router.push(`/${locale}/educator`);
      router.refresh();
    } catch (err) {
      setArchiveErr(errorText(err, m));
      setBusy(null);
    }
  }

  const toggle = (childId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });

  return (
    <section className="fam-panel" aria-labelledby={`${id}-title`} id="manage">
      <div>
        <h2 id={`${id}-title`} className="fam-panel__title">
          {t.title}
        </h2>
        <p className="fam-panel__sub">{t.sub}</p>
      </div>

      <form className="ed-renameForm" onSubmit={rename} noValidate>
        <div className="fam-field">
          <label className="fam-label" htmlFor={`${id}-name`}>
            {t.renameLabel}
          </label>
          <input
            id={`${id}-name`}
            className="fam-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setRenameMsg(null);
            }}
            aria-invalid={renameMsg && !renameMsg.ok ? true : undefined}
            aria-describedby={renameMsg ? `${id}-renameMsg` : undefined}
          />
        </div>
        <button
          type="submit"
          className="fam-btn fam-btn--sm"
          disabled={busy !== null || name.trim() === group.name}
          aria-busy={busy === 'rename'}
        >
          {busy === 'rename' && <span className="spinner" aria-hidden="true" />}
          {t.rename}
        </button>
        {renameMsg && (
          <p
            id={`${id}-renameMsg`}
            className={renameMsg.ok ? 'fam-caption fam-caption--ok' : 'fam-caption fam-caption--bad'}
            role={renameMsg.ok ? 'status' : 'alert'}
          >
            {renameMsg.text}
          </p>
        )}
      </form>

      <div className="ed-manageGrid">
        <div className="fam-stack">
          <h3 className="ed-subTitle">{fill(t.membersTitle, { n: members.length })}</h3>
          {members.length === 0 ? (
            <p className="fam-muted fam-small">{t.membersEmpty}</p>
          ) : (
            <ul className="ed-members">
              {members.map((c) => (
                <li key={c.id} className="ed-members__row">
                  <span className="ed-members__who">
                    <span>{c.name}</span>
                    {c.isOwnChild && <span className="fam-tag fam-tag--brand">{t.ownChild}</span>}
                  </span>
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm fam-btn--quiet"
                    onClick={() => void remove(c)}
                    disabled={busy !== null}
                    aria-busy={busy === `rm-${c.id}`}
                  >
                    {busy === `rm-${c.id}` && <span className="spinner" aria-hidden="true" />}
                    {t.remove}
                    <span className="visually-hidden"> — {c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {memberErr && (
            <p className="fam-alert" role="alert">
              {memberErr}
            </p>
          )}
        </div>

        <form className="fam-stack" onSubmit={add} noValidate>
          <fieldset className="ed-picker">
            <legend className="ed-subTitle">{t.addTitle}</legend>
            <p className="fam-muted fam-small">
              {group.grade === null
                ? t.addSubAny
                : fill(t.addSub, { grade: gradeName(locale, group.grade, m.common.gradeAny) })}
            </p>
            {candidates.length === 0 ? (
              <p className="fam-note">
                <Icon name="info" size={18} />
                {t.addNone}
              </p>
            ) : (
              <div className="ed-picker__list">
                {candidates.map((c) => (
                  <label key={c.id} className="fam-check ed-picker__item">
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                    <span className="ed-picker__body">
                      <span className="ed-picker__name">{c.name}</span>
                      <span className="fam-muted fam-small">
                        {c.groups.length ? fill(t.inGroups, { groups: c.groups.map((g) => g.name).join(', ') }) : t.noGroup}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {candidates.length > 0 && (
            <button type="submit" className="fam-btn fam-btn--sm ed-selfStart" disabled={busy !== null} aria-busy={busy === 'add'}>
              {busy === 'add' && <span className="spinner" aria-hidden="true" />}
              {fill(t.addSubmit, { n: picked.size })}
            </button>
          )}
          {addMsg && (
            <p className={addMsg.ok ? 'fam-caption fam-caption--ok' : 'fam-caption fam-caption--bad'} role={addMsg.ok ? 'status' : 'alert'}>
              {addMsg.text}
            </p>
          )}
        </form>
      </div>

      <hr className="fam-divider" />
      <button type="button" className="fam-btn fam-btn--sm fam-btn--danger ed-selfStart" onClick={() => setArchiveOpen(true)}>
        <Icon name="trash" size={16} />
        {t.archive}
      </button>
      <ConfirmDialog
        open={archiveOpen}
        title={fill(t.archiveTitle, { name: group.name })}
        body={t.archiveBody}
        confirmLabel={t.archiveConfirm}
        cancelLabel={m.common.cancel}
        busy={busy === 'archive'}
        error={archiveErr}
        onConfirm={() => void archive()}
        onClose={() => {
          setArchiveOpen(false);
          setArchiveErr(null);
        }}
      />
    </section>
  );
}
