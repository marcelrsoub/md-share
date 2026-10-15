# Admin folder browser implementation plan

## Outcome

Keep the minimal Quiet Workspace design and the two-screen sharing flow. Replace the flat library plus folder dropdown with a familiar folder browser: folder tree, current-directory listing, breadcrumbs, Back/Forward/Up, scoped search, and keyboard navigation. Opening a note still opens the existing preview/share screen.

## Scope and boundaries

- Admin-only change. Preserve the public editor, APIs, file safety, sharing mutations, expiry choices, settings, update notification, and conflict handling.
- Derive the hierarchy from the existing `NoteSummary[]` response. Include every ancestor of every Markdown note, even when an ancestor has no direct notes.
- Root is the empty relative directory string (`''`), displayed as **Vault**. Never use a display label such as `Root` as an identity: a real folder named `Root` must remain distinct.
- Only directories containing shareable Markdown notes appear; attachment-only and empty directories remain omitted. No directory enumeration endpoint or raw filesystem path API is added.
- No new framework, service, runtime dependency, version bump, commit, release, or live deployment is needed for this implementation phase.

## User experience

### Browsing

1. Initial view is Vault, showing immediate child folders first, then direct Markdown files; natural, case-insensitive name ordering within each group.
2. A narrow left navigation lists folders only. Chevron toggles expansion without navigation; clicking a folder name opens it. Current-folder ancestors expand automatically. The current folder is visibly and accessibly identified.
3. Main-list folders and files have plain recognizable icons. Single-click or Enter opens the item. File rows retain shared status and modification metadata. Folder metadata must not invent file timestamps.
4. Breadcrumbs show Vault and each directory segment, each ancestor clickable. Long names and deep paths wrap or scroll within their container, not the page.
5. Back/Forward navigate managed browser history, with disabled states at known boundaries. Up navigates to the parent and is disabled at Vault. Browser back/forward and the toolbar agree; do not navigate outside the app with an enabled in-app Back control.
6. Opening a file and returning restores the browser location, query, scopes, expanded tree, scroll position, and focus on the originating file row. Avoid forcing focus back to search in this flow.

### Search and Shared filter

- Load the full library once and on explicit refresh. Keep this canonical list separate from derived search results: typing must never shrink the tree or make a selected note unavailable.
- Search file names and relative paths using trimmed, case-insensitive, whitespace-separated terms (all terms must match). Default to current folder and descendants; offer explicit **Entire vault** scope.
- Search results are flat files with containing location metadata. A separate **Open containing folder** button must work without opening the file; do not nest interactive controls inside row buttons.
- Clearing search returns to the current browsing folder. Opening a containing folder clears the query and shows that directory.
- **All / Shared** stays compact. Shared means existing non-revoked links, preserving v0.1.2 semantics (expired links still appear). Folder tree and directory rows include only branches containing matching notes when Shared is active.
- Differentiate initial loading, failed fetch with retry, empty library, empty folder/filter view, and zero search results. Do not flash an empty/unavailable state before the initial library fetch settles.
- Refresh handles additions/deletions; missing current directories fall back to the nearest surviving ancestor with URL state reconciled. Deleted selected files show an actionable unavailable view; stale preview content must never appear under another file.

### Keyboard and mobile

- Main list: Arrow Up/Down, Home/End move focus; Enter opens; preserve normal Tab access to controls. Scope shortcuts to the relevant component; never intercept editor/input keys globally.
- Folder navigation: follow appropriate tree keyboard semantics (Up/Down, Right expand/child, Left collapse/parent, Home/End), or use accessible nested navigation controls without falsely declaring an ARIA tree. Buttons have labels and visible focus. Expansion and opening remain separate actions.
- On mobile, expose folders behind an explicit toggle/drawer; keep breadcrumbs, Up, search, and content usable. Closing it restores focus to its toggle; Escape closes it. No forced horizontal page overflow at 390px.
- Retain light/dark tokens and reduced-motion preferences.

## Data and navigation design

### Pure folder model (agent 1 owns)

New module: `src/client/admin/file-browser-model.ts` with no DOM/React dependencies. Frozen integration contract:

```ts
import type { NoteSummary, ShareSummary } from '../../shared/types.js';

export interface BrowserFolder {
  path: string;       // root: ''
  name: string;      // root display: 'Vault'
  parentPath: string | null;
  childPaths: string[]; // sorted immediate children
  notes: NoteSummary[]; // sorted immediate files
}
export interface FolderIndex {
  folders: Map<string, BrowserFolder>; // always contains ''
  notes: NoteSummary[];
}
export interface BrowserFolderEntry {
  type: 'folder'; key: string; path: string; name: string;
}
export interface BrowserNoteEntry {
  type: 'note'; key: string; note: NoteSummary;
}
export type BrowserEntry = BrowserFolderEntry | BrowserNoteEntry;

export function buildFolderIndex(notes: NoteSummary[]): FolderIndex;
export function getParentFolder(path: string): string | null;
export function getFolderAncestors(path: string): string[]; // includes root, excludes self; root -> []
export function getNoteFolder(note: NoteSummary): string; // '' for root files
export function getBreadcrumbs(path: string): Array<{ path: string; name: string }>;
export function resolveFolder(index: FolderIndex, requested: string): string; // nearest existing ancestor
export function getSharedNoteIds(shares: ShareSummary[]): Set<string>; // status !== revoked
export function folderContainsNotes(index: FolderIndex, path: string, allowedIds?: ReadonlySet<string>): boolean;
export function getFolderEntries(index: FolderIndex, path: string, allowedIds?: ReadonlySet<string>): BrowserEntry[];
export function searchNotes(index: FolderIndex, query: string, folder: string, scope: 'folder' | 'vault', allowedIds?: ReadonlySet<string>): BrowserNoteEntry[];
```

Folder matching must use directory-segment boundaries (`Work` must not include `Workshop`). Treat note IDs as opaque; avoid plain-object key collisions. Reject malformed navigation directory values or resolve them safely against the index; never turn them into filesystem API inputs. Note and folder row keys use distinct prefixes.

### Admin integration (agent 2 owns)

- `App.tsx`: canonical library fetch lifecycle, refresh, selected-note lookup independent of search, and integration with the browser UI/navigation. Share/preview side keeps existing behavior. Avoid unrelated changes to helper exports used by existing tests.
- `file-browser.tsx`: browser/tree/list components as needed, with explicit typed props and accessible controls.
- `use-file-browser.ts`: navigation hook/state helpers if warranted, kept local to admin. Use the frozen model contract above.
- URL: `folder` (omit for Vault), `q`, `searchScope=vault` (omit for default folder scope), `shared=1`, and existing `note` ID. Parse/validate enum values and preserve unrelated URL parameters. Folder/note transitions push history; typing replaces the current entry, avoiding one Back stop per character. Do not recreate history on popstate.
- Store focus/scroll snapshots in session history state or an in-memory entry map. Keep state serializable and namespaced; preserve unrelated `history.state` fields. A direct `?note=` link returns to the selected note's containing folder when no browser origin exists.
- Do not persist browsing state to localStorage; URL/history is sufficient. Expanded folders can remain in component state and survive file preview transitions.
- `editorial.css`: own responsive folder-browser styles, reusing approved tokens and existing detail/share styles. Ensure the admin shell actually has the layout/scroll behavior its CSS expects.

## Ownership and execution waves

1. Coordinator records this plan and verifies the working tree (baseline `c26dacd`, v0.1.2; clean).
2. Parallel, non-overlapping deliverables:
   - **Agent 1 — model:** only `file-browser-model.ts` and `tests/file-browser-model.test.ts`. Implement and test the frozen contract.
   - **Agent 2 — integration/UI:** only admin `App.tsx`, `editorial.css`, new `file-browser.tsx`, new `use-file-browser.ts`, plus new navigation tests if needed. Do not change model files or agent 1's tests. It may consume the agreed model contract before the file lands.
3. Coordinator reviews the actual combined diff and tests integration. Delegate narrowly scoped fixes to the appropriate owner; await completion notifications rather than polling.
4. Coordinator updates design notes, completes verification, and reports results/limits. Keep the live release unchanged during development.

## Acceptance and verification

### Automated tests

- Model: root files, deeply nested ancestors, directories without direct files, duplicate basenames in different directories, actual `Root` folder, Unicode/spaces, boundary matching (`Work` vs `Workshop`), stable folders-first natural ordering, opaque IDs (including object-prototype-like names), shared branch pruning, scoped multi-term search, and nearest-ancestor fallback.
- Navigation: URL round trip including reserved characters, invalid enums/folders, direct note links, push vs replace, popstate without extra entries, and restoration state where practical.
- Regression: existing admin expiry/version helpers, preview/share flows, server API boundaries, and public editor remain intact.
- Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`. The baseline has two integration failures locally from unavailable native SQLite bindings; if still blocked, explicitly distinguish them and run the suite in a suitable disposable Docker environment if available. Do not change dependencies merely to work around the host.

### Browser verification

Use the built application with deterministic synthetic fixtures in a disposable instance or mock API outside the repository; do not create/revoke shares or export writes in the user's live vault. Prefer existing browserless Chromium if Paseo's browser host is unavailable.

Check root -> nested folders -> breadcrumb/Up, tree expand vs open, Back/Forward, duplicate filenames, local vs vault search, Shared tree pruning, containing-folder navigation, preview then return with focus/scroll preserved, reload/deep links, keyboard controls, deleted-folder refresh, empty states, 390px mobile toggle and overflow, and light/dark appearance. Browser output must not publish private note names/content. Clean up only resources created for this verification.

## Definition of done

The folder browser is implemented in the real admin UI, the two-screen sharing workflow remains functional, meaningful tests and combined checks have run, browser acceptance cases have been exercised, and remaining limitations are reported. No success claim is based only on agent handoffs.

## Implementation and verification outcome

- Implemented the model, admin component integration, URL/history hook, responsive folder navigation, and model/navigation tests through GPT Luna implementation agents, followed by coordinator review and targeted fixes.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed. The build retains the existing large-chunk warning.
- All **58 tests across 11 files** passed in a disposable Docker test environment using the existing image's working native SQLite module. Source was copied into temporary container storage; the checkout was mounted read-only. This avoids changing host dependencies to address its known missing native binding.
- Real built-client/browser acceptance checks used an isolated Docker instance with synthetic nested notes and a separate data volume. Checked root/direct-directory listings, expansion without navigation, local/vault searches and duplicate names, Shared pruning, history replace/Forward, direct note return, focus/scroll restoration, reserved characters, invalid URL reconciliation, deleted-folder fallback on refresh, library/preview failure and retry, keyboard navigation, mobile opening/Escape/focus/inert state, page overflow, and dark tokens. No runtime errors were observed in the final check.
- Verification resources were isolated from the live notes and database. No production shares or exports were changed. Release and live deployment remain a separate step.
