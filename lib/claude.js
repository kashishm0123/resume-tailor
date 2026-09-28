import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getConfig } from "./store.js";

export const MODELS = {
  "claude-opus-5": "Claude Opus 5 (best quality)",
  "claude-sonnet-5": "Claude Sonnet 5 (faster, cheaper)",
};
const DEFAULT_MODEL = "claude-opus-5";

// On a host (Render) the key comes from the ANTHROPIC_API_KEY env var; locally it
// can also be saved from the Settings dialog.
async function client(requestedModel) {
  const cfg = await getConfig();
  const apiKey = process.env.ANTHROPIC_API_KEY || cfg.apiKey;
  if (!apiKey) {
    const err = new Error("No Anthropic API key set. Open Settings (⚙) and paste your key.");
    err.code = "NO_KEY";
    throw err;
  }
  return { anthropic: new Anthropic({ apiKey }), model: requestedModel in MODELS ? requestedModel : DEFAULT_MODEL };
}

export async function hasKey() {
  const cfg = await getConfig();
  return Boolean(cfg.apiKey || process.env.ANTHROPIC_API_KEY);
}

async function parse(requestedModel, schema, system, userContent, maxTokens = 16000) {
  const { anthropic, model } = await client(requestedModel);
  const response = await anthropic.messages.parse({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request. Try rephrasing or trimming the input.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The response was cut off (too long). Try a shorter resume or job description.");
  }
  if (!response.parsed_output) throw new Error("Could not read the model's response. Please try again.");
  return response.parsed_output;
}

// ---------- 1. Turn an uploaded resume (raw text) into clean Markdown ----------
const NormalizedResume = z.object({
  markdown: z.string(),
});

export async function normalizeResume(rawText, model) {
  const out = await parse(
    model,
    NormalizedResume,
    `You convert raw resume text (often extracted from a PDF or Word file, with broken line wraps) into clean Markdown.
Rules:
- Keep EVERY fact exactly as written: names, dates, employers, titles, numbers, links, skills. Do not add, remove, or reword content.
- Structure: "# Full Name" then a contact line, then "## Section" headings (e.g. Summary, Experience, Education, Skills, Projects), "### Role — Company" with a dates line, and "- " bullets.
- Fix only extraction artifacts (broken lines, stray page numbers, duplicated headers).`,
    `<raw_resume>\n${rawText}\n</raw_resume>`
  );
  return out.markdown.trim();
}

// ---------- 2. Decide whether fetched web page text is a job posting ----------
const ExtractedJob = z.object({
  is_job_posting: z.boolean(),
  reason_if_not: z.string(),
  job_title: z.string(),
  company: z.string(),
  job_description: z.string(),
});

export async function extractJobFromPage(pageText, url, model) {
  return parse(
    model,
    ExtractedJob,
    `You read the visible text of a web page and extract the job posting from it.
- If the page contains a real job posting (role, responsibilities and/or requirements), set is_job_posting=true and copy the complete job description text: about the role, responsibilities, requirements, nice-to-haves, and any tech stack. Drop navigation, cookie banners, "similar jobs", and footer text.
- If the page is a login wall, captcha, error page, search results list, or otherwise lacks the actual description, set is_job_posting=false, explain briefly in reason_if_not, and leave the other fields empty.`,
    `URL: ${url}\n<page_text>\n${pageText}\n</page_text>`
  );
}

// ---------- 3. Tailor the resume to a job ----------
const Change = z.object({
  section: z.string().describe("Resume section that changed, e.g. 'Summary' or 'Experience — Acme Corp'"),
  change_type: z.enum(["modified", "added", "removed", "reordered"]),
  before: z.string().describe("Original text (empty if added)"),
  after: z.string().describe("New text (empty if removed)"),
  reason: z.string().describe("Which part of the job description motivated this change"),
});

const TailorResult = z.object({
  tailored_resume_markdown: z.string(),
  summary_of_changes: z.string(),
  changes: z.array(Change),
  keywords_added: z.array(z.string()),
  gaps_not_addressed: z
    .array(z.string())
    .describe("Requirements in the job that the candidate's real experience does not show"),
  match_score_before: z.number().describe("0-100 estimate of fit of the ORIGINAL resume"),
  match_score_after: z.number().describe("0-100 estimate of fit of the TAILORED resume"),
});

const TAILOR_SYSTEM = `You are an expert resume writer and ATS specialist. You tailor a candidate's existing resume to one specific job description.

Honesty is non-negotiable:
- Never invent employers, titles, dates, degrees, certifications, metrics, tools, or responsibilities that are not supported by the original resume.
- You MAY rephrase bullets using the job's vocabulary when the underlying experience is genuinely the same (e.g. "built dashboards in Tableau" → "built data visualization dashboards (Tableau)" when the job asks for data visualization).
- You MAY reorder sections and bullets, rewrite the summary, surface relevant existing skills higher, and trim less relevant content.
- If the job needs something the candidate doesn't have, list it in gaps_not_addressed instead of faking it.

Output:
- tailored_resume_markdown: the complete resume in the same Markdown structure as the input (# name, ## sections, ### roles, - bullets). Keep it roughly the same length; one page worth of content if the original is one page.
- changes: one entry per meaningful edit, with the exact before/after text and the job-description reason. Be specific; the user reviews these to trust the result.
- summary_of_changes: 2-3 plain sentences.
- keywords_added: important job keywords now present in the resume that were not before.`;

export async function tailorResume(resumeMarkdown, job, model) {
  const jobHeader = [job.title && `Title: ${job.title}`, job.company && `Company: ${job.company}`]
    .filter(Boolean)
    .join("\n");
  return parse(
    model,
    TailorResult,
    TAILOR_SYSTEM,
    `<job_description>\n${jobHeader}\n${job.description}\n</job_description>\n\n<original_resume>\n${resumeMarkdown}\n</original_resume>`,
    16000
  );
}
