// Browser-side storage (IndexedDB) for the base resume and the catalogue of
// tailored versions. Data stays in this browser; Export/Import moves it around.
const DB = (() => {
  let dbp;
  function open() {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open("resume-tailor", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("kv");
        req.result.createObjectStore("versions", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  function slug(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  }

  return {
    getBase: async () => (await run("kv", "readonly", (s) => s.get("baseResume"))) || "",
    setBase: (md) => run("kv", "readwrite", (s) => s.put(md, "baseResume")),

    listVersions: async () =>
      ((await run("versions", "readonly", (s) => s.getAll())) || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    getVersion: (id) => run("versions", "readonly", (s) => s.get(id)),
    putVersion: (v) => run("versions", "readwrite", (s) => s.put(v)),
    deleteVersion: (id) => run("versions", "readwrite", (s) => s.delete(id)),

    async addVersion({ job, result, baseResume }) {
      const createdAt = new Date().toISOString();
      const v = {
        id: [createdAt.slice(0, 19).replace(/[:T]/g, "-"), slug(job.company), slug(job.title), Math.random().toString(16).slice(2, 6)]
          .filter(Boolean)
          .join("_"),
        createdAt,
        company: job.company || "",
        title: job.title || "",
        sourceUrl: job.url || "",
        jobDescription: job.description,
        baseResume,
        resume: result.tailored_resume_markdown,
        summary: result.summary_of_changes,
        changes: result.changes,
        keywordsAdded: result.keywords_added,
        gaps: result.gaps_not_addressed,
        matchBefore: result.match_score_before,
        matchAfter: result.match_score_after,
      };
      await this.putVersion(v);
      return v;
    },

    async exportAll() {
      return { app: "resume-tailor", exportedAt: new Date().toISOString(), baseResume: await this.getBase(), versions: await this.listVersions() };
    },

    async importAll(data) {
      if (data?.app !== "resume-tailor" || !Array.isArray(data.versions)) throw new Error("That isn't a Resume Tailor backup file.");
      if (data.baseResume && !(await this.getBase())) await this.setBase(data.baseResume);
      for (const v of data.versions) if (v?.id) await this.putVersion(v);
      return data.versions.length;
    },
  };
})();
