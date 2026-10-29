const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
function compile(file, requireModule) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: requireModule, URL });
  return module.exports;
}
const locale = compile("src/locale.ts");
const market = compile("src/market.ts", () => locale);
assert.equal(locale.defaultLanguage("en-US"), "en");
assert.equal(locale.defaultLanguage("pt-BR"), "pt");
assert.equal(locale.defaultLanguage("fr-FR"), "en");
assert.equal(locale.chartRangeLabel("max", "pt"), "TUDO");
assert.equal(locale.chartRangeLabel("1w", "pt"), "1S");
assert.equal(locale.sourceLabel("Yes", "pt"), "Sim");
assert.equal(locale.sourceLabel("SELL", "pt"), "Venda");
assert.equal(market.marketTitle({ title: "English title", title_pt: "Título em português" }, "en"), "English title");
assert.equal(market.marketTitle({ title: "English title" }, "pt"), "Traduzindo mercado…");
assert.equal(market.outcomeTitle({ title: "No", title_pt: "No" }, "pt"), "Não");
assert.equal(market.probabilityLabel(18.5, "pt"), "18,5");
const news = compile("src/news.ts", () => locale);
const now = Date.parse("2026-10-28T12:00:00Z");
const selected = news.latestHeadlines([
 {title:"Earlier",url:"https://example.com/earlier",published:"2026-10-27T12:00:00Z"},
 {title:"Latest",url:"https://example.com/latest",published:"2026-10-28T11:00:00Z"},
 {title:"Latest",url:"https://example.com/duplicate",published:"2026-10-28T11:00:00Z"},
 {title:"Unsafe",url:"javascript:alert(1)"},
 {title:"Outdated",url:"https://example.com/old",published:"2026-10-24T12:00:00Z"},
], now);
assert.equal(selected.map(row => row.title).join(","), "Latest,Earlier");
assert.equal(news.newsAge("invalid", "pt", now), "");
assert.equal(news.newsAge("2026-10-28T11:00:00Z", "pt", now), "há 1 hora");
assert.equal(news.newsAge("2026-10-29T12:00:00Z", "en", now), "this minute");
console.log("15 locale and headline regression checks passed");
