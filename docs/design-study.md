# MD Share UI design notes

The admin and public surfaces were redesigned around a quieter, more minimal language:

- Files are found on a dedicated screen with search, folder filter, and a shared-status filter.
- Selecting a file opens a second screen with only its preview and share links.
- The palette is warm off-white paper with dark plum ink and a single yellow primary action.
- Status is communicated with small colored dots, not badges; secondary link actions live in a small overflow menu.
- The public editor keeps the document as the main event with a compact top bar (status dot, collaborator initials, display-name chip).

## Where the styles live

- `src/client/styles-new.css` — shared tokens, primitives, editor, Markdown preview, and Kanban theming.
- `src/client/admin/editorial.css` — admin layout (files screen and preview/share screen).
- `src/client/public/editorial.css` — public workspace layout.

## Implementation notes

- The admin deep-links the selected file via `?note=<noteId>`; browser back/forward and refresh keep the selection.
- Returning to the files screen preserves search and filters and moves focus back to the search field.
- Revoked links are collected under a collapsed disclosure instead of cluttering the active link list.
- Expiry selection uses a native select with the existing preset values.
- Dark mode follows `prefers-color-scheme` with a plum-tinted dark palette; the yellow primary action carries over.

## History

Earlier design exploration included three concepts (Quiet Workspace, Paper & Ink, Studio). Quiet Workspace was selected and refined into a two-screen admin flow, then implemented. The other two concepts were intentionally dropped and are not part of the codebase.
