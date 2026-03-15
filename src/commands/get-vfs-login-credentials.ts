/**
 * Write first active VFS user's email, password and login URL to a temp file (for browser login).
 * Login URL is taken from the sheet column cabinet_link (the user's login page).
 * Usage: npm start -- get-vfs-login-credentials
 * Output: path to JSON file with { email, password, loginUrl }; file is .tmp/vfs-login.json
 */
import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, readUsers } from '../lib/sheets';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const OUT_DIR = '.tmp';
const OUT_FILE = 'vfs-login.json';

export async function getVfsLoginCredentialsCommand(): Promise<string> {
  const config = getConfig();
  validateEnvForSheets(config);
  await initializeSheets(config.googleCredentialsPath!, config.googleSheetsId!);
  const users = await readUsers();
  const vfsUser = users.find((u) => u.provider === 'vfsglobal');
  if (!vfsUser) {
    throw new Error('No active VFS user found in Google Sheets (check "VFS users" and active=TRUE).');
  }
  const loginUrl = vfsUser.cabinetLink?.trim() || '';
  if (!loginUrl) {
    throw new Error('VFS user has no cabinet_link in the table. Add the login page URL to cabinet_link.');
  }
  const dir = join(process.cwd(), OUT_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, OUT_FILE);
  await writeFile(
    path,
    JSON.stringify({
      email: vfsUser.email,
      password: vfsUser.password,
      loginUrl,
      vfs_centre: vfsUser.vfsCentre ?? '',
      vfs_category: vfsUser.vfsCategory ?? '',
      vfs_sub_category: vfsUser.vfsSubcategory ?? '',
    }),
    'utf8'
  );
  console.log(path);
  return path;
}
