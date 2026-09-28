// Server-side settings for local use only. Resumes and the catalogue live in the
// user's browser (IndexedDB), so the server stays stateless and works on hosts
// with ephemeral disks (e.g. Render's free plan).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, "..", "data");
const CONFIG = path.join(DATA_DIR, "config.json");

export async function getConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

export async function saveConfig(patch) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const next = { ...(await getConfig()), ...patch };
  await fs.writeFile(CONFIG, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
