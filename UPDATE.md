# Updating MD Share

MD Share is designed to update in place while keeping your notes, app data, and local configuration separate from the application code.

## Installer-based installs

Run the installer again from a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/marcelrsoub/md-share/main/install.sh | bash
```

The installer refreshes the application files, rebuilds the Docker image, and preserves your `notes`, `data`, `.env`, and `md-share.obsidian.env` files.

## Local clone or Compose installs

From the directory containing your MD Share checkout:

```bash
git pull --ff-only
docker compose --env-file .env -f docker-compose.obsidian.yml up --build -d
```

If you use the repository's local development Compose file, run:

```bash
git pull --ff-only
docker compose up --build -d
```

Use the same Compose file and environment file you used during setup. Before updating, make a backup of the `data` directory and your mounted notes folder.

## Verify the update

Open the admin UI, select Settings, and check the version shown at the bottom of the dialog. The current release is listed on [GitHub Releases](https://github.com/marcelrsoub/md-share/releases).
