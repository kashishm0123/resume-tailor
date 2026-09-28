import express from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

import * as store from "./lib/store.js";
import { fetchJob } from "./lib/jobfetch.js";
import { normalizeResume, tailorResume, hasKey, MODELS } from "./lib/claude.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4747;
// Hosts like Render set PORT and expect us on all interfaces; locally stay on loopback.
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const PUBLIC = HOST !== "127.0.0.1" && HOST !== "localhost";
const PASSWORD = process.env.APP_PASSWORD || "";

if (PUBLIC && !PASSWORD) {
  console.error("Refusing to start on a public address without APP_PASSWORD set.");
  process.exit(1);
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- password (HTTP Basic auth; the browser remembers it) ----------
function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

if (PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === "/healthz") return next();
    const [scheme, encoded] = (req.headers.authorization || "").split(" ");
    const pass = scheme === "Basic" ? Buffer.from(encoded || "", "base64").toString().split(":").slice(1).join(":") : "";
    if (pass && sameSecret(pass, PASSWORD)) return next();
    res.set("WWW-Authenticate", 'Basic realm="Resume Tailor", charset="UTF-8"').status(401).send("Password required");
  });
}

app.get("/healthz", (_req, res) => res.send("ok"));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(here, "public")));
app.use("/vendor/marked.js", express.static(path.join(here, "node_modules/marked/lib/marked.umd.js")));
app.use("/vendor/diff.js", express.static(path.join(here, "node_modules/diff/dist/diff.min.js")));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    const status = e.code === "NO_KEY" ? 400 : e.status === 401 ? 401 : 500;
    const msg = e.status === 401 ? "The Anthropic API key was rejected. Check it in Settings (⚙)." : e.message;
    res.status(status).json({ error: msg, code: e.code });
  });

// ---------- settings ----------
app.get("/api/settings", wrap(async (_req, res) => {
  res.json({
    hasKey: await hasKey(),
    keyFromServer: Boolean(process.env.ANTHROPIC_API_KEY),
    models: MODELS,
  });
}));

app.post("/api/settings", wrap(async (req, res) => {
  if (process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "The key is set on the server." });
  if (typeof req.body.apiKey === "string" && req.body.apiKey.trim()) {
    await store.saveConfig({ apiKey: req.body.apiKey.trim() });
  }
  res.json({ ok: true, hasKey: await hasKey() });
}));

// ---------- resume upload → Markdown ----------
app.post("/api/resume/parse", upload.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received." });
  const name = req.file.originalname.toLowerCase();
  let raw;
  if (name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(req.file.buffer));
    raw = (await extractText(pdf, { mergePages: true })).text;
  } else if (name.endsWith(".docx")) {
    raw = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
  } else if (/\.(txt|md|markdown)$/.test(name)) {
    raw = req.file.buffer.toString("utf8");
  } else {
    return res.status(400).json({ error: "Please upload a PDF, DOCX, TXT or MD file." });
  }
  if (!raw || raw.trim().length < 100) {
    return res.status(400).json({ error: "Couldn't read text from that file (is it a scanned image?). Paste the text instead." });
  }
  res.json({ markdown: await normalizeResume(raw, req.body.model) });
}));

// ---------- job fetch ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:");
}

app.post("/api/job/fetch", wrap(async (req, res) => {
  let url;
  try {
    url = new URL(String(req.body.url).trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: "That doesn't look like a valid web link." });
  }
  if (PUBLIC) {
    const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      return res.json({ ok: false, reason: "That address can't be reached from the server." });
    }
  }
  res.json(await fetchJob(url.href, req.body.model));
}));

// ---------- tailoring ----------
app.post("/api/tailor", wrap(async (req, res) => {
  const baseResume = String(req.body.baseResume || "");
  if (!baseResume.trim()) return res.status(400).json({ error: "Add your current resume first (step 1)." });
  const job = {
    title: String(req.body.title || ""),
    company: String(req.body.company || ""),
    url: String(req.body.url || ""),
    description: String(req.body.description || "").trim(),
  };
  if (job.description.length < 100) {
    return res.status(400).json({ error: "The job description is too short. Paste the full text of the posting." });
  }
  const result = await tailorResume(baseResume, job, req.body.model);
  res.json({ job, result });
}));

app.listen(PORT, HOST, () => {
  console.log(`\n  Resume Tailor is running →  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}\n`);
});
