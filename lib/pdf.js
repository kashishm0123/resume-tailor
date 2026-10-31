// Render resume Markdown (and cover letters) into a clean, text-based PDF.
// Generated server-side so there are no browser print headers/footers (URL, page
// title, date), and the text stays selectable for applicant tracking systems.
import PDFDocument from "pdfkit";
import { marked } from "marked";

const INK = "#1b1b1b";
const MUTED = "#555555";
const RULE = "#bbbbbb";
const MARGIN = 50; // ~18mm

// The built-in PDF fonts only cover WinAnsi; map common characters outside it.
function clean(s) {
  return String(s ?? "")
    .replace(/[→⇒➜]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[✓✔]/g, "-")
    .replace(/[‐‑]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ–—‘’“”•…€]/g, "");
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Flatten inline tokens into styled runs: { text, bold, italic, link }.
function runs(tokens, style = {}) {
  const out = [];
  for (const t of tokens || []) {
    if (t.type === "strong") out.push(...runs(t.tokens, { ...style, bold: true }));
    else if (t.type === "em") out.push(...runs(t.tokens, { ...style, italic: true }));
    else if (t.type === "link") out.push(...runs(t.tokens, { ...style, link: t.href }));
    else if (t.type === "br") out.push({ ...style, text: "\n" });
    else if (t.tokens) out.push(...runs(t.tokens, style));
    else if (t.type !== "html") out.push({ ...style, text: decode(t.text ?? t.raw ?? "") });
  }
  return out;
}

function font(doc, { bold, italic }) {
  doc.font(bold && italic ? "Helvetica-BoldOblique" : bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica");
}

function writeRuns(doc, list, opts = {}) {
  const parts = list.filter((r) => r.text);
  if (!parts.length) return;
  parts.forEach((r, i) => {
    font(doc, { bold: r.bold || opts.bold, italic: r.italic });
    doc.text(clean(r.text), {
      ...opts,
      continued: i < parts.length - 1,
      link: r.link || null,
      underline: false,
    });
  });
}

function newDoc(title) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: title, Creator: "Resume Tailor" },
    bufferPages: false,
  });
  doc.fillColor(INK);
  return doc;
}

function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function sectionRule(doc) {
  const y = doc.y + 2;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.y = y + 5;
}

// Start a new page if fewer than `needed` points remain, so headings and
// bullets aren't stranded at the bottom of a page.
function keepRoom(doc, needed) {
  if (doc.y + needed > doc.page.height - MARGIN) {
    doc.addPage();
    doc.x = MARGIN;
  }
}

function renderBlocks(doc, tokens, { first = true } = {}) {
  const width = doc.page.width - MARGIN * 2;
  let isFirstHeading = first;
  let afterName = false;

  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        if (t.depth === 1) {
          doc.fontSize(20).fillColor(INK);
          writeRuns(doc, runs(t.tokens), { bold: true });
          doc.moveDown(0.15);
          afterName = true;
        } else if (t.depth === 2) {
          keepRoom(doc, 70);
          doc.moveDown(isFirstHeading ? 0.4 : 0.7);
          doc.fontSize(10.5).fillColor(INK);
          writeRuns(doc, runs(t.tokens).map((r) => ({ ...r, text: r.text.toUpperCase() })), {
            bold: true,
            characterSpacing: 0.8,
          });
          sectionRule(doc);
          afterName = false;
        } else {
          keepRoom(doc, 50);
          doc.moveDown(0.35).fontSize(10.5).fillColor(INK);
          writeRuns(doc, runs(t.tokens), { bold: true });
          doc.moveDown(0.05);
          afterName = false;
        }
        isFirstHeading = false;
        break;
      }
      case "paragraph": {
        doc.fontSize(afterName ? 9.5 : 10).fillColor(afterName ? MUTED : INK);
        writeRuns(doc, runs(t.tokens), { lineGap: 1.5, width });
        doc.fillColor(INK).moveDown(afterName ? 0.2 : 0.3);
        afterName = false;
        break;
      }
      case "list": {
        doc.fontSize(10).fillColor(INK);
        t.items.forEach((item, i) => {
          keepRoom(doc, 28);
          const bullet = t.ordered ? `${(t.start || 1) + i}.` : "•";
          const y = doc.y;
          font(doc, {});
          doc.text(bullet, MARGIN + 4, y, { width: 12, lineBreak: false });
          doc.y = y;
          const inline = item.tokens.flatMap((tok) => (tok.type === "text" || tok.type === "paragraph") && tok.tokens ? tok.tokens : [tok]);
          doc.x = MARGIN + 16;
          writeRuns(doc, runs(inline), { width: width - 16, lineGap: 1.5 });
          doc.x = MARGIN;
          doc.moveDown(0.12);
        });
        doc.moveDown(0.2);
        afterName = false;
        break;
      }
      case "hr":
        sectionRule(doc);
        break;
      case "space":
        break;
      default:
        if (t.text) {
          doc.fontSize(10);
          writeRuns(doc, [{ text: decode(t.text) }], { width });
          doc.moveDown(0.3);
        }
    }
  }
}

export async function resumePdf(markdown, title = "Resume") {
  const doc = newDoc(title);
  renderBlocks(doc, marked.lexer(markdown.replace(/<[^>]*>/g, "")));
  return finish(doc);
}

// Header (name + contact line from the resume), date, then the letter body.
export async function coverLetterPdf({ resumeMarkdown, letter, title = "Cover Letter" }) {
  const doc = newDoc(title);
  const tokens = marked.lexer((resumeMarkdown || "").replace(/<[^>]*>/g, ""));
  const nameIdx = tokens.findIndex((t) => t.type === "heading" && t.depth === 1);
  const header = [];
  if (nameIdx >= 0) {
    header.push(tokens[nameIdx]);
    const next = tokens.slice(nameIdx + 1).find((t) => t.type !== "space");
    if (next?.type === "paragraph") header.push(next);
  }
  renderBlocks(doc, header);
  if (header.length) sectionRule(doc);

  const width = doc.page.width - MARGIN * 2;
  doc.moveDown(0.8).font("Helvetica").fontSize(10.5).fillColor(INK);
  doc.text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), { width });
  doc.moveDown(1);
  doc.text(clean(letter.greeting), { width });
  doc.moveDown(0.7);
  for (const p of letter.paragraphs) {
    doc.text(clean(p), { width, lineGap: 2.5, align: "left" });
    doc.moveDown(0.8);
  }
  doc.text(clean(letter.closing), { width });
  doc.moveDown(1.6);
  doc.font("Helvetica-Bold").text(clean(letter.signature_name), { width });
  return finish(doc);
}
