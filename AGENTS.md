# AGENTS.md

## Purpose

You are working on MD Share, a self-hosted Dockerized app for sharing one Markdown file at a time from a mounted Obsidian vault or notes folder.

Optimize for safe file handling, small vertical slices, and working software that is easy to understand and maintain.

## Project Shape

- Stack: Node.js, TypeScript, Express, Vite, React, SQLite, Yjs, WebSocket, CodeMirror 6.
- Admin UI runs on port `3020`.
- Public editor runs on port `3021`.
- Host data lives under `/notes` and `/data` inside the container.
- Deployment is Docker or Docker Compose first.

## Working Style

1. Inspect the existing code, tests, and scripts before changing anything.
2. Make the smallest safe change that moves the feature forward.
3. Keep public and admin surfaces separate.
4. Prefer explicit code and simple modules over abstractions.
5. Add or update tests for the behavior you touch.
6. Run the most relevant checks before finishing.
7. Report what changed, what you verified, and any remaining risk.

If a task is ambiguous, ask only the questions that would materially change the implementation. Otherwise, state the assumption and keep moving.

## Architecture Rules

- Keep the app as one server, one client build, one SQLite database.
- Do not introduce new services, queues, or frameworks unless the current stack cannot reasonably solve the problem.
- Reuse the existing scripts and conventions in this repo.
- Prefer surgical edits over broad rewrites.

## File Safety Rules

These rules are central to the project:

- Never accept raw file paths from public APIs.
- Only `.md` files inside the mounted notes directory can be shared.
- Validate real paths and guard against traversal and symlink escapes.
- Treat the public editor as token-based only.
- Never expose raw filesystem paths or note browsing on the public surface.
- On export, write a backup first.
- If the source file changed externally, do not overwrite it. Write a conflict copy instead.
- Log carefully. Avoid logging note contents, share tokens, secrets, or full file paths unless absolutely necessary.

## Testing And Verification

Use the cheapest test that gives confidence:

- Unit tests for path validation, token generation, hash comparison, safe writes, and conflict handling.
- Integration tests for file I/O, persistence, and API boundaries.
- End-to-end tests for the main admin-to-public collaboration flow when needed.
- Smoke checks for build, startup, and compose wiring.

Use the actual project commands:

```bash
npm test
npm run typecheck
npm run build
```

If Docker behavior changes, verify the compose files too.

Do not claim something is tested unless you ran it or clearly state that it was not run.

## Security And Reliability

- Treat security as basic hygiene, not theater.
- Add rate limiting where it protects the public or admin surfaces.
- Keep admin access on a trusted network or behind external auth if exposed.
- Validate inputs at the boundary and fail clearly.
- Prefer idempotent, boring operations.
- Handle missing files, stale state, and partial exports gracefully.

## Communication

When giving status, be concise and concrete.

Before implementation, a useful response usually includes:

- What you understood.
- Any assumption you are making.
- The shape of the change.
- The checks you plan to run.

After implementation, report:

- What changed.
- How it was verified.
- Any remaining gaps or follow-up work.

## Definition Of Done

A task is done only when:

- The requested behavior is implemented.
- The project still builds, or the reason it cannot is known.
- Relevant tests or checks were run, or explicitly noted as not run.
- Any important trade-offs or risks are called out clearly.
