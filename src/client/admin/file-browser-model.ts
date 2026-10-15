import type { NoteSummary, ShareSummary } from '../../shared/types.js';

export interface BrowserFolder {
  path: string;
  name: string;
  parentPath: string | null;
  childPaths: string[];
  notes: NoteSummary[];
}

export interface FolderIndex {
  folders: Map<string, BrowserFolder>;
  notes: NoteSummary[];
}

export interface BrowserFolderEntry {
  type: 'folder';
  key: string;
  path: string;
  name: string;
}

export interface BrowserNoteEntry {
  type: 'note';
  key: string;
  note: NoteSummary;
}

export type BrowserEntry = BrowserFolderEntry | BrowserNoteEntry;

const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** Return a normalized relative Markdown path, or null for malformed input. */
function getSafePathSegments(path: string): string[] | null {
  if (!path || path.startsWith('/') || path.includes('\\')) return null;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return segments;
}

function compareNames(left: string, right: string): number {
  return naturalNameCollator.compare(left, right) || compareCodePoints(left, right);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNotes(left: NoteSummary, right: NoteSummary): number {
  return compareNames(left.name, right.name)
    || compareNames(left.relativePath, right.relativePath)
    || compareCodePoints(left.id, right.id);
}

function isAllowed(note: NoteSummary, allowedIds?: ReadonlySet<string>): boolean {
  return allowedIds === undefined || allowedIds.has(note.id);
}

function isWithinFolder(noteFolder: string, folder: string): boolean {
  return folder === '' || noteFolder === folder || noteFolder.startsWith(`${folder}/`);
}

export function buildFolderIndex(notes: NoteSummary[]): FolderIndex {
  const folders = new Map<string, BrowserFolder>();
  folders.set('', { path: '', name: 'Vault', parentPath: null, childPaths: [], notes: [] });

  const safeNotes = notes.filter((note) => getSafePathSegments(note.relativePath) !== null);
  for (const note of safeNotes) {
    const segments = getSafePathSegments(note.relativePath)!;
    segments.pop();

    let parentPath = '';
    for (const segment of segments) {
      const childPath = parentPath ? `${parentPath}/${segment}` : segment;
      if (!folders.has(childPath)) {
        folders.set(childPath, {
          path: childPath,
          name: segment,
          parentPath,
          childPaths: [],
          notes: [],
        });
        folders.get(parentPath)!.childPaths.push(childPath);
      }
      parentPath = childPath;
    }
    folders.get(parentPath)!.notes.push(note);
  }

  for (const folder of folders.values()) {
    folder.childPaths.sort((left, right) => compareNames(folders.get(left)!.name, folders.get(right)!.name)
      || compareCodePoints(left, right));
    folder.notes.sort(compareNotes);
  }

  return { folders, notes: [...safeNotes].sort(compareNotes) };
}

export function getParentFolder(path: string): string | null {
  if (path === '') return null;
  const segments = getSafePathSegments(path);
  if (!segments) return null;
  segments.pop();
  return segments.join('/');
}

export function getFolderAncestors(path: string): string[] {
  if (path === '') return [];
  const segments = getSafePathSegments(path);
  if (!segments) return [];
  const ancestors = [''];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join('/'));
  }
  return ancestors;
}

export function getNoteFolder(note: NoteSummary): string {
  const segments = getSafePathSegments(note.relativePath);
  if (!segments) return '';
  segments.pop();
  return segments.join('/');
}

export function getBreadcrumbs(path: string): Array<{ path: string; name: string }> {
  if (path === '') return [{ path: '', name: 'Vault' }];
  const segments = getSafePathSegments(path);
  if (!segments) return [{ path: '', name: 'Vault' }];
  const breadcrumbs = [{ path: '', name: 'Vault' }];
  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    breadcrumbs.push({ path: currentPath, name: segment });
  }
  return breadcrumbs;
}

export function resolveFolder(index: FolderIndex, requested: string): string {
  if (requested === '') return '';
  const segments = getSafePathSegments(requested);
  if (!segments) return '';
  for (let length = segments.length; length > 0; length -= 1) {
    const candidate = segments.slice(0, length).join('/');
    if (index.folders.has(candidate)) return candidate;
  }
  return '';
}

export function getSharedNoteIds(shares: ShareSummary[]): Set<string> {
  return new Set(shares.filter((share) => share.status !== 'revoked').map((share) => share.noteId));
}

export function folderContainsNotes(
  index: FolderIndex,
  path: string,
  allowedIds?: ReadonlySet<string>,
): boolean {
  const folderPath = resolveFolder(index, path);
  return index.notes.some((note) => isAllowed(note, allowedIds) && isWithinFolder(getNoteFolder(note), folderPath));
}

export function getFolderEntries(
  index: FolderIndex,
  path: string,
  allowedIds?: ReadonlySet<string>,
): BrowserEntry[] {
  const folderPath = resolveFolder(index, path);
  const folder = index.folders.get(folderPath);
  if (!folder) return [];

  const childFolders: BrowserFolderEntry[] = folder.childPaths
    .filter((childPath) => folderContainsNotes(index, childPath, allowedIds))
    .map((childPath) => {
      const child = index.folders.get(childPath)!;
      return { type: 'folder', key: `folder:${childPath}`, path: childPath, name: child.name };
    });
  const directNotes: BrowserNoteEntry[] = folder.notes
    .filter((note) => isAllowed(note, allowedIds))
    .map((note) => ({ type: 'note', key: `note:${note.id}`, note }));
  return [...childFolders, ...directNotes];
}

export function searchNotes(
  index: FolderIndex,
  query: string,
  folder: string,
  scope: 'folder' | 'vault',
  allowedIds?: ReadonlySet<string>,
): BrowserNoteEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const folderPath = resolveFolder(index, folder);
  return index.notes
    .filter((note) => isAllowed(note, allowedIds))
    .filter((note) => scope === 'vault' || isWithinFolder(getNoteFolder(note), folderPath))
    .filter((note) => {
      const searchable = `${note.name}\n${note.relativePath}`.toLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .sort(compareNotes)
    .map((note) => ({ type: 'note', key: `note:${note.id}`, note }));
}
