# MD Share UI design notes

The admin and public surfaces were redesigned around a quieter, more minimal language:

- Files are found on a dedicated folder-browser screen with a compact folder tree, breadcrumbs, Back/Forward/Up, scoped search, and a shared-status filter.
- Selecting a file opens a second screen with only its preview and share links.
- The palette is warm off-white paper with dark plum ink and a single yellow primary action.
- Status is communicated with small colored dots, not badges; secondary link actions live in a small overflow menu.
- The public editor keeps the document as the main event with a compact top bar (status dot, collaborator initials, display-name chip).

## Where the styles live

- `src/client/styles-new.css` — shared tokens, primitives, editor, Markdown preview, and Kanban theming.
- `src/client/admin/editorial.css` — admin layout (files screen and preview/share screen).
- `src/client/admin/file-browser-model.ts` — folder index, current-directory entries, and scoped search over the canonical notes list.
- `src/client/admin/file-browser.tsx` — folder navigation and file-list UI, keyboard controls, and mobile folder panel.
- `src/client/admin/use-file-browser.ts` — URL/history navigation and browsing snapshots.
- `src/client/public/editorial.css` — public workspace layout.

## Implementation notes

- The browser starts at **Vault**, listing immediate subfolders before direct Markdown files. Intermediate folders are inferred from note paths; empty directories and attachment-only branches are omitted.
- Folder expansion and opening are separate controls. The tree stays stable while searching; Shared filtering removes branches with no non-revoked share links.
- Search matches all case-insensitive whitespace-separated terms in file names and relative paths. By default it searches the current directory and descendants; **Entire vault** broadens the scope. Search results offer an independent containing-folder action.
- The URL records the folder (`folder`), query (`q`), optional vault scope (`searchScope=vault`), Shared filter (`shared=1`), and selected file (`note`). Defaults are omitted and unrelated URL state is preserved.
- Returning from a preview preserves the originating folder, search, filters, expanded folders, scroll position, and focused file row. Direct note links without an originating browser location return to their containing folder.
- Main-list Arrow Up/Down and Home/End move focus, and Enter opens the focused item. The folder panel uses nested navigation buttons rather than claiming unsupported ARIA tree semantics.
- On mobile the folder navigation is a controlled slide-out panel, with focus placement, Escape/close focus return, and inert hidden controls.
- Revoked links are collected under a collapsed disclosure instead of cluttering the active link list.
- Expiry selection uses a native select with the existing preset values.
- Dark mode follows `prefers-color-scheme` with a plum-tinted dark palette; the yellow primary action carries over.

## History

Earlier design exploration included three concepts (Quiet Workspace, Paper & Ink, Studio). Quiet Workspace was selected and refined into a two-screen admin flow, then implemented. The other two concepts were intentionally dropped and are not part of the codebase.

The subsequent folder-navigation refinement follows `docs/folder-browser-plan.md`.
