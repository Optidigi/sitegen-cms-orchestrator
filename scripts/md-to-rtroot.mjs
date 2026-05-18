#!/usr/bin/env node
// Read markdown from stdin, emit RtRoot (block variant) JSON to stdout.
// Mapping per siab-payload/docs/runbooks/rt-dom-contract.md.
// Token shape from marked@^14.

import { marked } from "marked"
import { readFileSync } from "node:fs"

const md = readFileSync(0, "utf-8")
const tokens = marked.lexer(md)

function tokensToBlocks(tokens) {
  const out = []
  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        if (t.depth >= 2 && t.depth <= 4) {
          out.push({
            t: "heading",
            level: t.depth,
            children: inlineTokensToRtInline(t.tokens ?? []),
          })
        }
        // h1 dropped (page title owns h1); h5+ not in rt-dom-contract
        break
      case "paragraph":
        out.push({
          t: "paragraph",
          children: inlineTokensToRtInline(t.tokens ?? []),
        })
        break
      case "text":
        // Block-level `text` token appears inside non-loose list items
        // (marked emits it as a phrasing-content wrapper, not a paragraph).
        // Wrap its inline children in a paragraph so the result satisfies
        // listItem.children = blockSchema[].
        out.push({
          t: "paragraph",
          children: inlineTokensToRtInline(t.tokens ?? [{ type: "text", text: t.text }]),
        })
        break
      case "list":
        out.push({
          t: "list",
          ordered: !!t.ordered,
          items: (t.items ?? []).map(item => ({
            t: "listItem",
            children: tokensToBlocks(item.tokens ?? []),
          })),
        })
        break
      case "blockquote":
        out.push({
          t: "blockquote",
          children: tokensToBlocks(t.tokens ?? []),
        })
        break
      case "hr":
        out.push({ t: "divider" })
        break
      case "code":
        // Fenced code block; RtNode has no block-code type — render inline as fallback.
        out.push({
          t: "paragraph",
          children: [{ t: "text", v: t.text, marks: ["code"] }],
        })
        break
      case "space":
        break  // skip empty lines
      case "html":
      case "table":
        process.stderr.write(`[md-to-rtroot] skipped unsupported token type: ${t.type}\n`)
        break
      default:
        process.stderr.write(`[md-to-rtroot] skipped unknown token type: ${t.type}\n`)
    }
  }
  return out
}

function inlineTokensToRtInline(tokens) {
  const out = []
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        // Inline text may itself carry nested tokens (marked emits this
        // inside list_item.tokens[0]); recurse instead of flattening to t.text.
        if (Array.isArray(t.tokens) && t.tokens.length > 0) {
          out.push(...inlineTokensToRtInline(t.tokens))
        } else {
          out.push({ t: "text", v: t.text })
        }
        break
      case "strong":
        out.push(...wrapMark(t.tokens ?? [{ type: "text", text: t.text }], "bold"))
        break
      case "em":
        out.push(...wrapMark(t.tokens ?? [{ type: "text", text: t.text }], "italic"))
        break
      case "codespan":
        out.push({ t: "text", v: t.text, marks: ["code"] })
        break
      case "del":
        out.push(...wrapMark(t.tokens ?? [{ type: "text", text: t.text }], "strikethrough"))
        break
      case "link": {
        // Normalize href to satisfy siab-payload's hrefSchema:
        // - must startsWith("/") OR have a valid URL protocol (http/https/mailto/tel)
        // - empty / null hrefs: flatten to plain text (drop link wrapper)
        // - anchor-only hrefs (#foo): normalize to /#foo
        const rawHref = t.href ?? ""
        const innerInline = inlineTokensToRtInline(t.tokens ?? [{ type: "text", text: t.text }])
        if (rawHref === "") {
          // Flatten — emit inner text without the link wrapper
          out.push(...innerInline)
          break
        }
        const href = rawHref.startsWith("#") ? `/${rawHref}` : rawHref
        // Treat any absolute URI with a scheme (http(s), mailto, tel, ftp, etc.)
        // as external; only relative refs (/, #, ?, or no-scheme) are internal.
        out.push({
          t: "link",
          href,
          rel: /^[a-z][a-z0-9+.-]*:/i.test(href) ? "external" : "internal",
          children: innerInline,
        })
        break
      }
      case "br":
        out.push({ t: "linebreak" })
        break
      case "image":
        process.stderr.write(`[md-to-rtroot] skipped inline image: ${t.href} (use Hero/FeatureList blocks for images instead)\n`)
        break
      default:
        process.stderr.write(`[md-to-rtroot] skipped unknown inline token: ${t.type}\n`)
    }
  }
  return out
}

function wrapMark(tokens, mark) {
  const inner = inlineTokensToRtInline(tokens)
  return inner.map(n =>
    n.t === "text"
      ? { ...n, marks: [...(n.marks ?? []), mark] }
      : n
  )
}

const rt = {
  t: "root",
  variant: "block",
  children: tokensToBlocks(tokens),
}

process.stdout.write(JSON.stringify(rt))
