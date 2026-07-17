import packageJson from '../../../package.json';

export const APP_VERSION = packageJson.version;
export const GITHUB_REPO_URL = packageJson.homepage;
export const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/marcelrsoub/md-share/releases/latest';
export const GITHUB_UPDATE_GUIDE_URL = `${GITHUB_REPO_URL}/blob/main/UPDATE.md`;
