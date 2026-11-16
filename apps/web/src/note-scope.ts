// 노트 역할 · 해시태그 · 요약 카드 (노트에 묻기 범위 좁히기, 2026-10-26): 검색 문서를 저장할 때 노트 메타에 함께 맞추고,
// 질문이 오면 메타(역할 · 태그) + 색인의 요약 카드(소제목 · 키워드)로 범위 단계를 만든다 (@dn/search scope.ts).
// 모두 기기 안 계산 — 토큰을 쓰지 않는다.
import { newId, type Engine } from '@dn/engine-core';
import { BUILTIN_ROLES, guessRole, noteDigest, scopeStages, type NoteInfo, type NoteRole, type ScopeNote, type ScopeResult, type SearchDoc, type SearchIndex } from '@dn/search';
import { tagKey, type MetaStore, type NoteMeta, type Tag } from '@dn/storage-idb';

/** 기본 역할 + 사용자가 만든 역할 */
export const allRoles = (custom: readonly NoteRole[] = []): NoteRole[] => [...BUILTIN_ROLES, ...custom.filter((r) => !BUILTIN_ROLES.some((b) => b.id === r.id))];
export const roleName = (roles: readonly NoteRole[], id: string | undefined): string | undefined => (id ? roles.find((r) => r.id === id)?.name : undefined);
/** 노트의 쓰이는 역할: 직접 정한 것, 없으면 추정한 것 */
export const effectiveRole = (m: Pick<NoteMeta, 'role' | 'roleGuess'> | undefined): string | undefined => m?.role ?? m?.roleGuess;

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 검색 문서를 저장하기 전에: 역할(직접 · 추정) · 글 속 #태그를 노트 메타에 맞추고, 요약 카드(최소 요약 md)를 문서에 붙인다.
 * 글에서 #낱말을 지우면 그 낱말로 붙었던 태그도 뗀다. 결과: 태그 목록이 바뀌었나(새 태그 · 노트 태그) — 바뀌면 목록을 새로 고친다
 */
export async function syncNoteScope(meta: MetaStore, engine: Engine, doc: SearchDoc, roles: readonly NoteRole[]): Promise<boolean> {
  const id = engine.note.id;
  const n = await meta.get(id);
  if (!n) return false;
  const role = engine.note.role && roles.some((r) => r.id === engine.note.role) ? engine.note.role : undefined;
  const roleGuess = role ? undefined : guessRole(engine.note.title, doc.headings ?? [], roles);
  let tags: Tag[] = (doc.hashtags ?? []).length || n.tagIds?.length ? await meta.listTags() : [];
  let created = false;
  const hashIds: string[] = [];
  for (const name of doc.hashtags ?? []) {
    const key = tagKey(name);
    if (!key) continue;
    let t = tags.find((x) => x.nameKey === key);
    if (!t) {
      const fresh: Tag = { id: newId(), name, nameKey: key, createdAt: Date.now() };
      if (await meta.putTag(fresh)) { t = fresh; tags = [...tags, fresh]; created = true; } else { tags = await meta.listTags(); t = tags.find((x) => x.nameKey === key); }
    }
    if (t && !hashIds.includes(t.id)) hashIds.push(t.id);
  }
  const prevHash = n.hashTagIds ?? [];
  const tagIds = [...new Set([...(n.tagIds ?? []).filter((t) => !prevHash.includes(t) || hashIds.includes(t)), ...hashIds])];
  const patch: Partial<NoteMeta> = {};
  if (n.role !== role) patch.role = role;
  if (n.roleGuess !== roleGuess) patch.roleGuess = roleGuess;
  if (!same(prevHash, hashIds)) patch.hashTagIds = hashIds.length ? hashIds : undefined;
  const tagsChanged = !same(n.tagIds ?? [], tagIds);
  if (tagsChanged) patch.tagIds = tagIds.length ? tagIds : undefined;
  if (Object.keys(patch).length) await meta.patch(id, patch);
  const eff = role ?? roleGuess;
  const names = tagIds.map((t) => tags.find((x) => x.id === t)?.name).filter((x): x is string => !!x);
  doc.digest = noteDigest({ title: engine.note.title, ...(eff ? { role: { name: roleName(roles, eff) ?? eff, guessed: !role } } : {}), tags: names, headings: doc.headings ?? [], keywords: doc.keywords ?? [] });
  return created || tagsChanged;
}

/** 질문 → 범위 단계 (역할 · 태그 → 요약 카드). `infos`: 범위 안 노트(휴지통 · 잠긴 노트는 이미 뺀 것) */
export function scopeStagesFor(question: string, infos: readonly NoteInfo[], metas: readonly NoteMeta[], tags: readonly Tag[], index: SearchIndex, roles: readonly NoteRole[]): ScopeResult[] {
  const byId = new Map(metas.map((m) => [m.id, m]));
  const names = new Map(tags.map((t) => [t.id, t.name]));
  const notes: ScopeNote[] = infos.map((i) => {
    const m = byId.get(i.id), c = index.card(i.id), role = effectiveRole(m);
    return {
      id: i.id, title: i.title, updatedAt: i.updatedAt, ...(role ? { role } : {}),
      tags: (m?.tagIds ?? []).map((t) => names.get(t)).filter((x): x is string => !!x),
      headings: c?.headings ?? [], keywords: c?.keywords ?? [],
    };
  });
  return scopeStages(question, notes, roles);
}
