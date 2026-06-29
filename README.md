# MD Share

MD Share is a tiny self-hosted way to share one Markdown note at a time and edit it together in the browser.

- Admin UI: `http://localhost:3020`
- Public editor: `http://localhost:3021`

## Quick start

Clone the repo and review the files first:

```bash
git clone https://github.com/marcelrsoub/md-share.git
cd md-share
bash install.sh
```

The installer asks for your notes folder path, writes a local env file, and starts Docker Compose.

If you prefer the convenience shortcut, you can still run the installer directly. This tracks the current `main` branch:

```bash
curl -fsSL https://raw.githubusercontent.com/marcelrsoub/md-share/main/install.sh | bash
```

To pin installs to the first public release once it is tagged, use:

```bash
curl -fsSL https://raw.githubusercontent.com/marcelrsoub/md-share/v0.0.1/install.sh | bash
```

## Notes Folder

The mounted notes directory can be:

- an Obsidian vault
- a plain folder of Markdown files

See [`.env.example`](.env.example) for the supported variables.

## Docker Compose

- [`docker-compose.obsidian.yml`](docker-compose.obsidian.yml) is the supported install path for mounting an existing notes folder.
- [`docker-compose.yml`](docker-compose.yml) is a simple local/dev compose file that mounts `./notes` and `./data` from the repo root.

## Cloudflare Tunnel

Point Cloudflare Tunnel at the public editor on `3021` and keep the admin UI private.

```bash
cloudflared tunnel --url http://localhost:3021
```

For a named tunnel, set `PUBLIC_BASE_URL` to your public hostname and route the tunnel to the same `3021` service.

## Safety

- Only `.md` files inside your mounted vault can be shared.
- Public links only open the note behind that token.
- Keep the admin UI on a trusted network or behind your own auth.
