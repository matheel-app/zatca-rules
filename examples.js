#!/usr/bin/env node
// Reproduces every tested_example in rules.json: applies the change to its invoice and checks that ZATCA's rules
// (via validate.js) now fail with that rule id. Usage: node examples.js [RULE-ID …]
const fs = require("fs"), path = require("path");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const { validate } = require("./validate");

const rules = require("./rules.json").filter((r) => r.tested_example && (process.argv.length < 3 || process.argv.includes(r.id)));

async function source(invoice) {
  if (invoice.startsWith("https://")) return (await fetch(invoice)).text();
  if (invoice.startsWith("invoices/")) return fs.readFileSync(path.join(__dirname, invoice), "utf8");
  return null; // a ZATCA SDK sample: not redistributed here
}

// Follows an /a[1]/b[3] path where each index counts element children, as the fuzzer wrote it.
function locate(doc, p) {
  let node = doc.documentElement;
  for (const step of p.split("/").filter(Boolean)) {
    const idx = Number(step.match(/\[(\d+)\]$/)[1]);
    let n = 0, found = null;
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && ++n === idx) { found = c; break; }
    if (!(node = found)) return null;
  }
  return node;
}

function apply(xml, e) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const el = locate(doc, e.xpath);
  if (!el) return null;
  if (e.change === "remove") el.parentNode.removeChild(el);
  else if (e.change === "duplicate") el.parentNode.insertBefore(el.cloneNode(true), el.nextSibling);
  else if (e.change === "text") el.textContent = e.value;
  else if (e.change === "attr-remove") el.removeAttribute(e.attr);
  else el.setAttribute(e.attr, e.value);
  return new XMLSerializer().serializeToString(doc);
}

(async () => {
  let ok = 0, skipped = 0, bad = [];
  const cache = {};
  for (const r of rules) {
    const e = r.tested_example;
    const xml = (cache[e.invoice] ??= await source(e.invoice));
    if (xml === null) { skipped++; continue; }
    const changed = apply(xml, e);
    const fired = changed && (await validate(changed)).some((f) => f.id === r.id || f.id.startsWith(r.id + "-"));
    fired ? ok++ : bad.push(r.id);
  }
  console.log(`${ok} reproduced, ${bad.length} did not${bad.length ? ": " + bad.join(" ") : ""}, ${skipped} need the ZATCA SDK sample`);
  process.exit(bad.length ? 1 : 0);
})();
