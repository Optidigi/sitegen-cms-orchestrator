import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HELPER = join(__dirname, "md-to-rtroot.mjs")

function run(md) {
  const result = spawnSync("node", [HELPER], { input: md, encoding: "utf-8" })
  if (result.status !== 0) {
    throw new Error(`helper exited ${result.status}: ${result.stderr}`)
  }
  return JSON.parse(result.stdout)
}

test("emits RtRoot wrapper with block variant", () => {
  const out = run("hello world")
  assert.equal(out.t, "root")
  assert.equal(out.variant, "block")
  assert.ok(Array.isArray(out.children))
})

test("paragraph + text", () => {
  const out = run("hello world")
  assert.equal(out.children.length, 1)
  assert.equal(out.children[0].t, "paragraph")
  assert.equal(out.children[0].children[0].t, "text")
  assert.equal(out.children[0].children[0].v, "hello world")
})

test("heading levels 2-4 mapped, h1 dropped (page-title owns it)", () => {
  const out = run("# top\n## sub\n### subsub\n#### subsubsub")
  const headings = out.children.filter(n => n.t === "heading")
  assert.equal(headings.length, 3)
  assert.deepEqual(headings.map(h => h.level), [2, 3, 4])
})

test("unordered list", () => {
  const out = run("- one\n- two")
  const list = out.children[0]
  assert.equal(list.t, "list")
  assert.equal(list.ordered, false)
  assert.equal(list.items.length, 2)
  assert.equal(list.items[0].t, "listItem")
})

test("ordered list", () => {
  const out = run("1. one\n2. two")
  const list = out.children[0]
  assert.equal(list.t, "list")
  assert.equal(list.ordered, true)
})

test("blockquote wraps inner blocks", () => {
  const out = run("> wisdom")
  assert.equal(out.children[0].t, "blockquote")
})

test("horizontal rule → divider", () => {
  const out = run("---")
  assert.equal(out.children[0].t, "divider")
})

test("bold inline mark", () => {
  const out = run("**bold** text")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("bold")))
})

test("italic inline mark", () => {
  const out = run("*italic*")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("italic")))
})

test("inline code", () => {
  const out = run("`code`")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("code")))
})

test("link with external rel for http href", () => {
  const out = run("[ex](https://example.com)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.href, "https://example.com")
  assert.equal(link.rel, "external")
})

test("link with internal rel for relative href", () => {
  const out = run("[here](/about)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.href, "/about")
  assert.equal(link.rel, "internal")
})

test("strikethrough mark", () => {
  const out = run("~~gone~~")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("strikethrough")))
})

test("fenced code block → paragraph with code mark", () => {
  const out = run("```\nlet x = 1\n```")
  const para = out.children[0]
  assert.equal(para.t, "paragraph")
  assert.equal(para.children[0].marks?.[0], "code")
})

test("empty input → empty children", () => {
  const out = run("")
  assert.deepEqual(out, { t: "root", variant: "block", children: [] })
})

test("h1 stripped from output (page title owns h1)", () => {
  const out = run("# Page Title\n\nbody text")
  assert.ok(!out.children.some(n => n.t === "heading" && n.level === 1))
})

test("mailto: link → external rel", () => {
  const out = run("[email](mailto:hello@example.com)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.rel, "external")
  assert.equal(link.href, "mailto:hello@example.com")
})

test("tel: link → external rel", () => {
  const out = run("[call](tel:+31123456)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.rel, "external")
})

test("anchor-only link normalized to /#anchor (satisfies hrefSchema /-prefix rule)", () => {
  const out = run("[top](#section)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.href, "/#section")
  assert.equal(link.rel, "internal")
})

test("empty href flattens to plain text (no link wrapper)", () => {
  const out = run("[broken]()")
  const inline = out.children[0].children
  // Should be a text node, not a link node
  assert.ok(!inline.some(n => n.t === "link"), "no link node should remain")
  assert.ok(inline.some(n => n.t === "text" && n.v === "broken"), "inner text preserved")
})
