const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  baseResume: "",
  versions: [],
  current: null, // open catalogue version
  pendingUrl: "", // URL we failed to fetch, kept so it's saved with the version
};

// ---------- helpers ----------
function getModel() {
  try { return localStorage.getItem("model") || "claude-opus-5"; } catch { return "claude-opus-5"; }
}
function setModel(m) {
  try { localStorage.setItem("model", m); } catch {}
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.code = data.code;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

function showError(msg, code) {
  const box = $("#errorBox");
  box.innerHTML = esc(msg) + (code === "NO_KEY" ? ' <a href="#" data-open-settings>Open settings</a>' : "");
  box.hidden = false;
}

function progress(title, sub = "") {
  $("#progress").hidden = !title;
  $("#progressTitle").textContent = title || "";
  $("#progressSub").textContent = sub;
  $("#goBtn").disabled = Boolean(title);
}

function isUrl(text) {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) || /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(t);
}

function firstLine(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : md.trim().split("\n")[0].slice(0, 60);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderMd(md) {
  // Resume content comes from the user's own file / the model; strip raw HTML anyway.
  return marked.parse(md.replace(/<[^>]*>/g, ""));
}

// ---------- resume (step 1) ----------
function renderResumeCard() {
  const has = state.baseResume.trim().length > 0;
  $("#resumeEmpty").hidden = has;
  $("#resumeLoaded").hidden = !has;
  $("#editResumeBtn").hidden = !has;
  $("#resumeEditor").hidden = true;
  if (has) $("#resumeName").textContent = firstLine(state.baseResume);
}

function openResumeEditor() {
  $("#resumeText").value = state.baseResume;
  $("#resumeEditor").hidden = false;
  $("#resumeEmpty").hidden = true;
  $("#resumeLoaded").hidden = true;
  $("#resumeText").focus();
}

async function uploadResume(file) {
  $("#errorBox").hidden = true;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("model", getModel());
  progress("Reading your resume…", "Converting it into an editable format. This takes a few seconds.");
  try {
    const { markdown } = await api("/api/resume/parse", { method: "POST", body: fd });
    state.baseResume = markdown;
    await DB.setBase(markdown);
    renderResumeCard();
    toast("Resume loaded. Check it with “Edit” if you like.");
  } catch (e) {
    showError(e.message, e.code);
  } finally {
    progress(null);
  }
}

$("#resumeFile").addEventListener("change", (e) => e.target.files[0] && uploadResume(e.target.files[0]));
$("#pasteResumeLink").addEventListener("click", (e) => (e.preventDefault(), openResumeEditor()));
$("#editResumeBtn").addEventListener("click", openResumeEditor);
$("#cancelResumeBtn").addEventListener("click", renderResumeCard);
$("#saveResumeBtn").addEventListener("click", async () => {
  state.baseResume = $("#resumeText").value;
  await DB.setBase(state.baseResume);
  renderResumeCard();
  toast("Resume saved.");
});

const dz = $("#resumeCard");
dz.addEventListener("dragover", (e) => (e.preventDefault(), $("#resumeEmpty").classList.add("over")));
dz.addEventListener("dragleave", () => $("#resumeEmpty").classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  $("#resumeEmpty").classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) uploadResume(f);
});

// ---------- job (step 2) ----------
$("#jobInput").addEventListener("input", () => {
  const v = $("#jobInput").value.trim();
  $("#inputHint").textContent = !v
    ? "We'll detect whether it's a link or a description."
    : isUrl(v)
      ? "🔗 Link detected — we'll read the job post for you."
      : "📄 Job description detected.";
  $("#jobMeta").hidden = !v || isUrl(v);
});

function askForPaste(url, reason) {
  state.pendingUrl = url;
  const n = $("#fetchNotice");
  n.innerHTML = `
    <strong>We couldn't read that job post automatically.</strong> ${esc(reason)}
    <ol>
      <li><a href="${esc(url)}" target="_blank" rel="noopener">Open the job posting</a> in your browser.</li>
      <li>Select the job description text (title, responsibilities, requirements) and copy it.</li>
      <li>Paste it in the box below and press <b>Tailor my resume</b>.</li>
    </ol>`;
  n.hidden = false;
  $("#jobInput").value = "";
  $("#jobInput").placeholder = "Paste the job description text here…";
  $("#jobMeta").hidden = false;
  $("#inputHint").textContent = "Paste the description, then press Tailor.";
  $("#jobInput").focus();
}

async function go() {
  $("#errorBox").hidden = true;
  const input = $("#jobInput").value.trim();
  if (!state.baseResume.trim()) return showError("First add your current resume in step 1.");
  if (!input) return showError("Paste a job link or the job description.");

  let job;
  try {
    if (isUrl(input)) {
      const url = /^https?:/i.test(input) ? input : `https://${input}`;
      progress("Reading the job post…", url);
      const r = await api("/api/job/fetch", { method: "POST", body: JSON.stringify({ url, model: getModel() }) });
      if (!r.ok) {
        progress(null);
        return askForPaste(url, r.reason);
      }
      job = r.job;
    } else {
      job = {
        description: input,
        title: $("#jobTitle").value.trim(),
        company: $("#jobCompany").value.trim(),
        url: state.pendingUrl,
      };
    }

    const label = [job.title, job.company].filter(Boolean).join(" at ") || "this job";
    progress(`Tailoring your resume for ${label}…`, "Matching your experience to the job. Usually 30–90 seconds.");
    const { job: savedJob, result } = await api("/api/tailor", {
      method: "POST",
      body: JSON.stringify({ ...job, baseResume: state.baseResume, model: getModel() }),
    });
    const version = await DB.addVersion({ job: savedJob, result, baseResume: state.baseResume });

    // reset compose form
    $("#jobInput").value = "";
    $("#jobTitle").value = "";
    $("#jobCompany").value = "";
    $("#fetchNotice").hidden = true;
    $("#jobInput").dispatchEvent(new Event("input"));
    state.pendingUrl = "";

    await loadCatalogue();
    openVersion(version);
  } catch (e) {
    showError(e.message, e.code);
  } finally {
    progress(null);
  }
}
$("#goBtn").addEventListener("click", go);
$("#jobInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
});

// ---------- catalogue ----------
async function loadCatalogue() {
  state.versions = await DB.listVersions();
  renderCatalogue();
}

function renderCatalogue() {
  const q = $("#catSearch").value.toLowerCase();
  const list = state.versions.filter((v) => `${v.company} ${v.title}`.toLowerCase().includes(q));
  $("#catEmpty").hidden = state.versions.length > 0;
  $("#catalogue").innerHTML = list
    .map(
      (v) => `
      <li data-id="${esc(v.id)}" class="${state.current?.id === v.id ? "active" : ""}">
        <div class="t">${esc(v.company || "Untitled company")}</div>
        <div class="s"><span>${esc(v.title || "Role")}</span><span>${fmtDate(v.createdAt)}</span></div>
        <div class="s"><span>${v.changes.length} change${v.changes.length === 1 ? "" : "s"}</span><span>${Math.round(v.matchBefore)}% → ${Math.round(v.matchAfter)}%</span></div>
      </li>`
    )
    .join("");
}
$("#catSearch").addEventListener("input", renderCatalogue);
$("#catalogue").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  openVersion(await DB.getVersion(li.dataset.id));
});
$("#newBtn").addEventListener("click", showCompose);

function showCompose() {
  state.current = null;
  $("#resultView").hidden = true;
  $("#composeView").hidden = false;
  renderCatalogue();
}

// ---------- result view ----------
function wordDiffHtml(a, b) {
  return Diff.diffWordsWithSpace(a || "", b || "")
    .map((p) => (p.added ? `<ins class="ins">${esc(p.value)}</ins>` : p.removed ? `<del class="del">${esc(p.value)}</del>` : esc(p.value)))
    .join("");
}

function openVersion(v) {
  state.current = v;
  $("#composeView").hidden = true;
  $("#resultView").hidden = false;
  $("#errorBox").hidden = true;

  $("#rTitle").textContent = [v.title, v.company].filter(Boolean).join(" · ") || "Tailored resume";
  $("#rSub").textContent = `Saved ${new Date(v.createdAt).toLocaleString()}`;
  $("#rScore").innerHTML = `Estimated match<br>${Math.round(v.matchBefore)}% → <b>${Math.round(v.matchAfter)}%</b>`;
  $("#rSummary").textContent = v.summary;

  $("#rKeywords").innerHTML = v.keywordsAdded?.length
    ? `<div class="section-label">Keywords from the job now in your resume</div>
       <div class="chips">${v.keywordsAdded.map((k) => `<span class="chip">${esc(k)}</span>`).join("")}</div>`
    : "";

  $("#rChanges").innerHTML =
    `<div class="section-label">${v.changes.length} change${v.changes.length === 1 ? "" : "s"} made to match the job description</div>` +
    v.changes
      .map(
        (c) => `
      <div class="change">
        <div class="change-head">
          <span class="sec">${esc(c.section)}</span>
          <span class="badge ${esc(c.change_type)}">${esc(c.change_type)}</span>
        </div>
        <div class="text">${
          c.change_type === "added"
            ? `<ins class="ins">${esc(c.after)}</ins>`
            : c.change_type === "removed"
              ? `<del class="del">${esc(c.before)}</del>`
              : wordDiffHtml(c.before, c.after)
        }</div>
        <div class="why"><b>Why:</b> ${esc(c.reason)}</div>
      </div>`
      )
      .join("");

  $("#rGaps").innerHTML = v.gaps?.length
    ? `<div class="section-label">Job requirements your resume doesn't show (not faked — consider addressing these in a cover letter)</div>
       <div class="chips">${v.gaps.map((g) => `<span class="chip gap">${esc(g)}</span>`).join("")}</div>`
    : "";

  $("#rResume").innerHTML = renderMd(v.resume);
  $("#versionEditor").hidden = true;
  $("#rDiff").innerHTML = wordDiffHtml(v.baseResume, v.resume);
  $("#rJob").textContent = v.jobDescription;
  $("#rJobUrl").innerHTML = v.sourceUrl
    ? `Source: <a href="${esc(v.sourceUrl)}" target="_blank" rel="noopener">${esc(v.sourceUrl)}</a>`
    : "";

  selectTab("changes");
  renderCatalogue();
  window.scrollTo(0, 0);
}

function selectTab(name) {
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((p) => (p.hidden = p.dataset.panel !== name));
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

function fileBase() {
  const v = state.current;
  const name = firstLine(v.resume).replace(/[^\w]+/g, "_");
  const co = (v.company || "job").replace(/[^\w]+/g, "_");
  return `${name}_Resume_${co}`;
}

$("#pdfBtn").addEventListener("click", () => {
  selectTab("resume");
  const prev = document.title;
  document.title = fileBase(); // becomes the default PDF filename
  window.print();
  document.title = prev;
});

$("#mdBtn").addEventListener("click", () => {
  const blob = new Blob([state.current.resume], { type: "text/markdown" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${fileBase()}.md` });
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#rResume").innerText);
  toast("Resume text copied.");
});

$("#editVersionBtn").addEventListener("click", () => {
  $("#versionText").value = state.current.resume;
  $("#versionEditor").hidden = false;
  $("#rResume").hidden = true;
});
$("#cancelVersionBtn").addEventListener("click", () => {
  $("#versionEditor").hidden = true;
  $("#rResume").hidden = false;
});
$("#saveVersionBtn").addEventListener("click", async () => {
  const md = $("#versionText").value;
  state.current.resume = md;
  await DB.putVersion(state.current);
  $("#rResume").innerHTML = renderMd(md);
  $("#rDiff").innerHTML = wordDiffHtml(state.current.baseResume, md);
  $("#versionEditor").hidden = true;
  $("#rResume").hidden = false;
  toast("Saved.");
});

$("#deleteBtn").addEventListener("click", async () => {
  if (!confirm("Delete this saved version? This can't be undone.")) return;
  await DB.deleteVersion(state.current.id);
  await loadCatalogue();
  showCompose();
  toast("Version deleted.");
});

// ---------- backup ----------
$("#exportBtn").addEventListener("click", async () => {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `resume-tailor-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const n = await DB.importAll(JSON.parse(await f.text()));
    state.baseResume = await DB.getBase();
    renderResumeCard();
    await loadCatalogue();
    toast(`Imported ${n} version${n === 1 ? "" : "s"}.`);
  } catch (err) {
    showError(err.message);
  }
});

// ---------- settings ----------
async function openSettings() {
  const s = await api("/api/settings");
  $("#modelSel").innerHTML = Object.entries(s.models)
    .map(([id, label]) => `<option value="${id}" ${id === getModel() ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
  $("#keyField").hidden = s.keyFromServer;
  $("#keyStatus").textContent = s.keyFromServer
    ? "✓ Claude access is configured on the server (no key needed here)."
    : s.hasKey
      ? "✓ A key is saved."
      : "No key saved yet — get one at console.anthropic.com.";
  $("#apiKey").value = "";
  $("#settingsDlg").showModal();
}
$("#settingsBtn").addEventListener("click", openSettings);
document.addEventListener("click", (e) => {
  if (e.target.matches("[data-open-settings]")) (e.preventDefault(), openSettings());
});
$("#settingsForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "default") return;
  setModel($("#modelSel").value);
  if ($("#apiKey").value.trim()) {
    await api("/api/settings", { method: "POST", body: JSON.stringify({ apiKey: $("#apiKey").value }) });
  }
  $("#errorBox").hidden = true;
  toast("Settings saved.");
});

// ---------- boot ----------
(async function init() {
  const [markdown, settings] = await Promise.all([DB.getBase(), api("/api/settings"), loadCatalogue()]);
  state.baseResume = markdown;
  renderResumeCard();
  if (!settings.hasKey) openSettings();
})();
