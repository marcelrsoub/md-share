#!/usr/bin/env bash
set -euo pipefail

repo_url="${MD_SHARE_REPO_URL:-https://github.com/marcelrsoub/md-share.git}"
repo_branch="${MD_SHARE_REPO_BRANCH:-main}"
install_root="${MD_SHARE_INSTALL_DIR:-$HOME/.md-share}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

has_repo_files() {
  local candidate_dir="$1"
  [[ -f "$candidate_dir/Dockerfile" && -f "$candidate_dir/docker-compose.obsidian.yml" && -f "$candidate_dir/package.json" ]]
}

escape_env_value() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/\\$/g'
}

repo_slug_from_url() {
  local url="${1%.git}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url#git@github.com:}"
  printf '%s' "$url"
}

read_env_value() {
  local key="$1"
  local line=""

  if [[ -f "$config_file" ]]; then
    line="$(grep -m1 "^${key}=" "$config_file" || true)"
  fi

  line="${line#*=}"
  if [[ ${line:0:1} == '"' && ${line: -1} == '"' ]]; then
    line="${line:1:-1}"
    line="${line//\\\\/\\}"
    line="${line//\\\"/\"}"
    line="${line//\\\$/\$}"
  fi

  printf '%s' "$line"
}

clone_repo() {
  local target_dir="$1"

  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "$repo_branch" "$repo_url" "$target_dir"
    return 0
  fi

  require_command curl
  require_command tar

  local archive_url archive_file
  archive_url="https://codeload.github.com/$(repo_slug_from_url "$repo_url")/tar.gz/refs/heads/${repo_branch}"
  archive_file="$(mktemp)"
  curl -fsSL "$archive_url" -o "$archive_file"
  mkdir -p "$target_dir"
  tar -xzf "$archive_file" -C "$target_dir" --strip-components=1
  rm -f "$archive_file"
  return 0

  echo "This installer needs either git or curl+tar to fetch the project files." >&2
  exit 1
}

copy_repo_tree() {
  local source_dir="$1"
  local target_dir="$2"
  local source_entry
  local target_entry
  local base_name
  local source_names_file

  source_names_file="$(mktemp)"

  while IFS= read -r -d '' source_entry; do
    base_name="$(basename "$source_entry")"
    printf '%s\n' "$base_name" >> "$source_names_file"
  done < <(find "$source_dir" -mindepth 1 -maxdepth 1 -print0)

  while IFS= read -r -d '' target_entry; do
    base_name="$(basename "$target_entry")"
    case "$base_name" in
      md-share.obsidian.env | .env | data | notes)
        continue
        ;;
    esac

    if ! grep -Fxq "$base_name" "$source_names_file"; then
      rm -rf "$target_entry"
    fi
  done < <(find "$target_dir" -mindepth 1 -maxdepth 1 -print0)

  while IFS= read -r -d '' source_entry; do
    base_name="$(basename "$source_entry")"
    case "$base_name" in
      md-share.obsidian.env | .env | data | notes)
        continue
        ;;
    esac

    rm -rf "$target_dir/$base_name"
    cp -R "$source_entry" "$target_dir/"
  done < <(find "$source_dir" -mindepth 1 -maxdepth 1 -print0)

  rm -f "$source_names_file"
}

refresh_repo() {
  local target_dir="$1"

  if command -v git >/dev/null 2>&1; then
    if [[ -d "$target_dir/.git" ]]; then
      git -C "$target_dir" pull --ff-only
      return 0
    fi

    git -C "$target_dir" init >/dev/null
    git -C "$target_dir" remote add origin "$repo_url" 2>/dev/null || git -C "$target_dir" remote set-url origin "$repo_url"
    git -C "$target_dir" fetch --depth 1 origin "$repo_branch"
    git -C "$target_dir" checkout -f FETCH_HEAD
    git -C "$target_dir" clean -fdx -e md-share.obsidian.env -e .env -e data -e notes
    git -C "$target_dir" branch -M "$repo_branch" >/dev/null 2>&1 || true
    return 0
  fi

  require_command find
  require_command cp

  local fresh_dir
  fresh_dir="$(mktemp -d)"
  clone_repo "$fresh_dir"
  copy_repo_tree "$fresh_dir" "$target_dir"
  rm -rf "$fresh_dir"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prompt_with_default() {
  local prompt_text="$1"
  local default_value="$2"
  local reply=""

  if [[ -n "$default_value" ]]; then
    printf '%s [%s]: ' "$prompt_text" "$default_value" >&"$tty_fd"
  else
    printf '%s: ' "$prompt_text" >&"$tty_fd"
  fi

  if ! IFS= read -r -u "$tty_fd" reply; then
    reply=""
  fi
  if [[ -n "$reply" ]]; then
    printf '%s' "$reply"
  else
    printf '%s' "$default_value"
  fi
}

choose_value() {
  local env_value="$1"
  local prompt_text="$2"
  local default_value="$3"

  if [[ -n "$env_value" ]]; then
    printf '%s' "$env_value"
  else
    prompt_with_default "$prompt_text" "$default_value"
  fi
}

require_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

repo_root=""
repo_root_needs_refresh=false
for candidate_dir in "$PWD" "$script_dir"; do
  if has_repo_files "$candidate_dir"; then
    repo_root="$candidate_dir"
    break
  fi
done

if [[ -n "$repo_root" && "$repo_root" == "$install_root" ]]; then
  repo_root_needs_refresh=true
fi

if [[ -z "$repo_root" ]]; then
  repo_root="$install_root"
  if has_repo_files "$repo_root"; then
    repo_root_needs_refresh=true
  elif [[ -d "$repo_root/.git" ]]; then
    repo_root_needs_refresh=true
  else
    mkdir -p "$(dirname "$repo_root")"
    clone_repo "$repo_root"
  fi
fi

if [[ "$repo_root_needs_refresh" == true ]]; then
  refresh_repo "$repo_root"
fi

config_file="$repo_root/md-share.obsidian.env"
if [[ ! -f "$config_file" && -f "$repo_root/.env" ]]; then
  config_file="$repo_root/.env"
fi
compose_file="$repo_root/docker-compose.obsidian.yml"

if ! has_repo_files "$repo_root"; then
  echo "The project files were not found after setup." >&2
  exit 1
fi

vault_default="${OBSIDIAN_VAULT_PATH:-$(read_env_value OBSIDIAN_VAULT_PATH)}"
data_default="${MD_SHARE_DATA_PATH:-$(read_env_value MD_SHARE_DATA_PATH)}"
data_default="${data_default:-$repo_root/data}"
admin_default="${ADMIN_BASE_URL:-$(read_env_value ADMIN_BASE_URL)}"
admin_default="${admin_default:-http://localhost:3020}"
public_default="${PUBLIC_BASE_URL:-$(read_env_value PUBLIC_BASE_URL)}"
public_default="${public_default:-http://localhost:3021}"

if [[ -r /dev/tty ]]; then
  tty_fd=3
  exec 3<>/dev/tty
else
  echo "This installer needs an interactive terminal." >&2
  exit 1
fi

vault_path="$(choose_value "${OBSIDIAN_VAULT_PATH:-}" 'Obsidian vault path' "${vault_default:-}")"
vault_path="${vault_path%/}"
if [[ -z "$vault_path" ]]; then
  echo "OBSIDIAN_VAULT_PATH is required." >&2
  exit 1
fi

if [[ ! -d "$vault_path" ]]; then
  echo "Vault path does not exist: $vault_path" >&2
  exit 1
fi

data_path="$(choose_value "${MD_SHARE_DATA_PATH:-}" 'Host folder for app data' "$data_default")"
admin_base_url="$(choose_value "${ADMIN_BASE_URL:-}" 'Admin base URL' "$admin_default")"
public_base_url="$(choose_value "${PUBLIC_BASE_URL:-}" 'Public base URL' "$public_default")"

cat > "$config_file" <<EOF
# Generated by install.sh
# Edit this file if you move your vault or want to expose MD Share at a different URL.
OBSIDIAN_VAULT_PATH="$(escape_env_value "$vault_path")"
MD_SHARE_DATA_PATH="$(escape_env_value "$data_path")"
ADMIN_BASE_URL="$(escape_env_value "$admin_base_url")"
PUBLIC_BASE_URL="$(escape_env_value "$public_base_url")"
EOF

cd "$repo_root"
docker compose --env-file "$config_file" -f "$compose_file" up --build -d

cat <<EOF
MD Share is up.
Installed in: $repo_root
Admin UI: $admin_base_url
Public UI: $public_base_url

Config file written to: $config_file
Use \`docker compose --env-file "$config_file" -f "$compose_file" down\` to stop it.
EOF
