import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDirectory = resolve("public-docs/content");
const outputDirectory = resolve("public-docs/site");

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const rendered = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      rendered.push("</ul>");
      listOpen = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      closeList();
      rendered.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      rendered.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      rendered.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.startsWith("- ")) {
      if (!listOpen) {
        rendered.push("<ul>");
        listOpen = true;
      }
      rendered.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      rendered.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return rendered.join("\n");
}

const [guide, updates, styles] = await Promise.all([
  readFile(resolve(sourceDirectory, "guide.md"), "utf8"),
  readFile(resolve(sourceDirectory, "major-updates.md"), "utf8"),
  readFile(resolve("public-docs/styles.css"), "utf8")
]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const content = `${markdownToHtml(guide)}\n<section class="updates">${markdownToHtml(updates)}</section>`;
const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Public operations guide for the FRC Attendance System."><title>FRC Attendance System Guide</title><link rel="stylesheet" href="styles.css"></head>
<body><a class="skip-link" href="#guide">Skip to guide</a><header class="site-header"><div><a class="brand" href="#top">FRC Attendance System</a><p>Public operations guide</p></div><nav aria-label="Guide sections"><a href="#quickstart">Quickstart</a><a href="#meetings-and-attendance">Meetings</a><a href="#kiosk-use-and-wi-fi-recovery">Kiosks</a><a href="#troubleshooting">Help</a></nav></header><main id="guide"><article>${content}</article><aside class="site-note"><h2>About this guide</h2><p>This site is designed for everyday team operations. It intentionally excludes credentials, private infrastructure details, member data, and unrestricted administrative procedures.</p><p><a href="https://github.com/isriah/FRC-Attendance-System">View the project on GitHub</a></p></aside></main><footer><span>FRC Attendance System</span><a href="https://github.com/isriah/FRC-Attendance-System/tree/main">Source and public docs on GitHub</a></footer></body></html>`;
await Promise.all([
  writeFile(resolve(outputDirectory, "index.html"), document),
  writeFile(resolve(outputDirectory, "styles.css"), styles)
]);
