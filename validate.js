#!/usr/bin/env node
// Checks a UBL invoice against ZATCA's business rules (EN 16931 + KSA Schematron from SDK 3.4.8, compiled to SEF),
// locally. Usage: node validate.js invoice.xml [more.xml …]   Exit code 1 when any rule fails with "error".
// The compiled rules (~5 MB) are fetched once from matheel.app and cached in .sef/.
const fs = require("fs"), path = require("path");
const SaxonJS = require("saxon-js");
const { DOMParser } = require("@xmldom/xmldom");

const CACHE = path.join(__dirname, ".sef"), SVRL = "http://purl.oclc.org/dsdl/svrl";
const rules = Object.fromEntries(require("./rules.json").map((r) => [r.id, r]));

async function sef(name) {
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://matheel.app/validator/${name}`);
    if (!res.ok) throw new Error(`could not download ${name}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

function run(stylesheet, xml) {
  const out = SaxonJS.transform({ stylesheetFileName: stylesheet, sourceText: xml, destination: "serialized" }, "sync");
  const doc = new DOMParser().parseFromString(out.principalResult, "application/xml");
  return [...Array.from(doc.getElementsByTagNameNS(SVRL, "failed-assert"))].map((f) => ({
    id: f.getAttribute("id"), flag: f.getAttribute("flag"),
    text: (f.getElementsByTagNameNS(SVRL, "text")[0]?.textContent || "").trim(),
  }));
}

/** Returns every failed rule for one invoice: [{id, flag, text, fix, url}]. */
async function validate(xml) {
  const sheets = [await sef("cen.sef.json"), await sef("ksa.sef.json")];
  return sheets.flatMap((s) => run(s, xml)).map((f) => ({
    ...f, fix: rules[f.id]?.en_fix, url: rules[f.id]?.url_en,
  }));
}

module.exports = { validate };

if (require.main === module) {
  (async () => {
    let bad = false;
    for (const file of process.argv.slice(2)) {
      const fails = await validate(fs.readFileSync(file, "utf8"));
      bad ||= fails.some((f) => f.flag === "error");
      console.log(fails.length ? `✗ ${file}` : `✓ ${file}: passes every ZATCA business rule`);
      for (const f of fails) console.log(`  ${f.flag.padEnd(7)} ${f.id}  ${f.text}${f.fix ? `\n          fix: ${f.fix}` : ""}${f.url ? `\n          ${f.url}` : ""}`);
    }
    if (!process.argv[2]) console.log("usage: node validate.js invoice.xml [more.xml …]");
    process.exit(bad ? 1 : 0);
  })().catch((e) => { console.error(e.message); process.exit(2); });
}
