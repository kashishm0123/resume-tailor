// Turn a job-post URL into job-description text, or explain why we couldn't.
import * as cheerio from "cheerio";
import { extractJobFromPage } from "./claude.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function htmlToText(html) {
  const $ = cheerio.load(`<div id="x">${html}</div>`);
  $("br").replaceWith("\n");
  $("li").each((_, el) => $(el).prepend("• ").append("\n"));
  $("p,div,h1,h2,h3,h4,ul,ol").each((_, el) => $(el).append("\n"));
  return $("#x")
    .text()
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Most job boards (Greenhouse, Lever, Workday, LinkedIn public pages, Indeed…) embed
// schema.org JobPosting JSON-LD for Google Jobs. That's the cleanest source.
function findJsonLdJob($) {
  const blocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get();
  for (const raw of blocks) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const node = stack.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      const type = [].concat(node["@type"] || []);
      if (type.includes("JobPosting") && node.description) {
        const org = node.hiringOrganization;
        return {
          title: node.title || "",
          company: (typeof org === "string" ? org : org?.name) || "",
          description: htmlToText(node.description),
        };
      }
    }
  }
  return null;
}

function visibleText($) {
  $("script,style,noscript,svg,nav,footer,header,form,iframe").remove();
  const main = $("main").length ? $("main") : $("body");
  return main.text().replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export async function fetchJob(url, model) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { ok: false, reason: `Couldn't reach that page (${e.name === "TimeoutError" ? "timed out" : e.message}).` };
  }
  if (!res.ok) {
    return { ok: false, reason: `The site returned HTTP ${res.status}${res.status === 403 || res.status === 999 ? " — it blocks automated access" : ""}.` };
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const ld = findJsonLdJob($);
  if (ld && ld.description.length > 200) {
    return { ok: true, source: "structured data", job: { ...ld, url } };
  }

  const text = visibleText($).slice(0, 60000);
  if (text.length < 300) {
    return {
      ok: false,
      reason: "The page loaded almost no text — it's probably rendered by JavaScript or behind a login.",
    };
  }

  const extracted = await extractJobFromPage(text, url, model);
  if (!extracted.is_job_posting || extracted.job_description.length < 150) {
    return { ok: false, reason: extracted.reason_if_not || "Couldn't find a job description on that page." };
  }
  return {
    ok: true,
    source: "page text",
    job: { title: extracted.job_title, company: extracted.company, description: extracted.job_description, url },
  };
}
