import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const outputDir = path.join(root, 'docs', 'pdf')
const logoPath = path.join(root, 'public', 'brand', 'saturn-star-icon-full-color.png')

const documents = [
  {
    source: path.join(root, 'docs', 'saturn-star-crm-operating-playbook.md'),
    output: path.join(outputDir, 'Saturn-Star-CRM-Operating-Playbook.pdf'),
    title: 'CRM Operating Playbook',
    eyebrow: 'SATURN STAR MOVING',
    subtitle: 'The complete Saturn Star experience and operating standard—from first inquiry through final care.',
    edition: 'Version 1.1 · July 2026',
    toc: true,
    compact: false,
  },
  {
    source: path.join(root, 'docs', 'saturn-star-crm-desk-reference.md'),
    output: path.join(outputDir, 'Saturn-Star-CRM-Desk-Reference.pdf'),
    title: 'CRM Desk Reference',
    eyebrow: 'SATURN STAR MOVING',
    subtitle: 'A practical live-work guide for calm conversations, clear recommendations, responsible estimates, and continuity of care.',
    edition: 'Version 1.1 · July 2026',
    toc: false,
    compact: true,
  },
]

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function inlineMarkdown(value = '') {
  let output = escapeHtml(value)
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>')
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  return output
}

function parseTable(lines, start) {
  if (start + 1 >= lines.length || !lines[start].includes('|') || !/^\s*\|?[\s:-]+\|/.test(lines[start + 1])) {
    return null
  }

  const rows = []
  let index = start
  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    if (index !== start + 1) {
      rows.push(lines[index].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
    }
    index += 1
  }

  if (!rows.length) return null
  const [head, ...body] = rows
  return {
    end: index,
    html: `<div class="table-wrap"><table><thead><tr>${head.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body
      .map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`,
  }
}

function renderMarkdown(markdown, { toc }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const output = []
  const headings = []
  let paragraph = []
  let listType = null
  let listItems = []
  let quoteLines = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    output.push(`<p>${inlineMarkdown(paragraph.join(' ').trim())}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!listItems.length || !listType) return
    output.push(`<${listType}>${listItems.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${listType}>`)
    listItems = []
    listType = null
  }
  const flushQuote = () => {
    if (!quoteLines.length) return
    output.push(`<blockquote>${quoteLines.map(line => `<p>${inlineMarkdown(line)}</p>`).join('')}</blockquote>`)
    quoteLines = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let index = 0; index < lines.length;) {
    const raw = lines[index]
    const line = raw.trim()

    const table = parseTable(lines, index)
    if (table) {
      flushAll()
      output.push(table.html)
      index = table.end
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushAll()
      const level = heading[1].length
      const title = heading[2].trim()
      if (level === 1) {
        index += 1
        continue
      }
      const id = slugify(title)
      headings.push({ level, title, id })
      output.push(`<h${level} id="${id}">${inlineMarkdown(title)}</h${level}>`)
      index += 1
      continue
    }

    if (/^[-*_]{3,}$/.test(line)) {
      flushAll()
      output.push('<hr>')
      index += 1
      continue
    }

    const unordered = line.match(/^[-*]\s+(.+)$/)
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      flushQuote()
      const nextType = ordered ? 'ol' : 'ul'
      if (listType && listType !== nextType) flushList()
      listType = nextType
      listItems.push((unordered || ordered)[1])
      index += 1
      continue
    }

    if (line.startsWith('>')) {
      flushParagraph()
      flushList()
      quoteLines.push(line.replace(/^>\s?/, ''))
      index += 1
      continue
    }

    if (!line) {
      flushAll()
      index += 1
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line)
    index += 1
  }
  flushAll()

  const tocHtml = toc
    ? `<section class="toc">
        <div class="section-label">QUICK NAVIGATION</div>
        <h2>Contents</h2>
        <div class="toc-grid">
          ${headings
            .filter(item => item.level === 2)
            .map((item, index) => `<a href="#${item.id}"><span>${String(index + 1).padStart(2, '0')}</span>${inlineMarkdown(item.title.replace(/^\d+\.\s*/, ''))}</a>`)
            .join('')}
        </div>
      </section>`
    : ''

  return `${tocHtml}<article>${output.join('\n')}</article>`
}

function documentHtml(doc, markdown, logoDataUrl) {
  const body = renderMarkdown(markdown, { toc: doc.toc })
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(doc.title)}</title>
      <style>
        :root {
          --navy: #071421;
          --gold: #C99700;
          --gold-dark: #8A6800;
          --ivory: #F7F4ED;
          --charcoal: #111827;
          --muted: #667085;
          --border: #E5E7EB;
          --white: #FFFFFF;
        }
        * { box-sizing: border-box; }
        html { color: var(--charcoal); font-family: "Avenir Next", Avenir, "Helvetica Neue", Arial, sans-serif; }
        body { margin: 0; background: var(--white); font-size: ${doc.compact ? '9.5pt' : '10pt'}; line-height: ${doc.compact ? '1.42' : '1.55'}; }
        .cover {
          min-height: ${doc.compact ? '9.15in' : '9.1in'};
          break-after: page;
          background: var(--navy);
          color: white;
          padding: 0.48in 0.5in 0.45in;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }
        .cover::before {
          content: "";
          position: absolute;
          width: 4.7in;
          height: 4.7in;
          border: 1px solid rgba(201,151,0,.25);
          border-radius: 50%;
          right: -2.35in;
          top: -1.6in;
        }
        .cover::after {
          content: "";
          position: absolute;
          width: 3.2in;
          height: 3.2in;
          border: 1px solid rgba(255,255,255,.09);
          border-radius: 50%;
          right: -1.25in;
          top: -0.65in;
        }
        .brand-lockup { display: flex; align-items: center; gap: 15px; position: relative; z-index: 2; }
        .brand-lockup img { width: 58px; height: 58px; object-fit: contain; }
        .brand-name { font-size: 16px; font-weight: 750; letter-spacing: .01em; }
        .brand-sub { color: #D7DDE2; font-size: 9px; letter-spacing: .2em; margin-top: 4px; }
        .cover-main { margin-top: auto; margin-bottom: auto; max-width: 6.25in; position: relative; z-index: 2; }
        .eyebrow, .section-label { color: var(--gold); font-size: 9px; font-weight: 800; letter-spacing: .2em; }
        .cover h1 { margin: 17px 0 22px; font-size: ${doc.compact ? '42px' : '48px'}; line-height: 1.02; letter-spacing: -.035em; }
        .gold-rule { width: 74px; height: 5px; background: var(--gold); margin: 0 0 24px; }
        .cover .subtitle { color: #D7DDE2; font-size: 15px; line-height: 1.55; max-width: 5.7in; }
        .cover-footer { border-top: 1px solid rgba(255,255,255,.16); padding-top: 18px; display: flex; justify-content: space-between; color: #BCC6CE; font-size: 9px; position: relative; z-index: 2; }
        .cover-footer strong { color: white; }
        .toc { break-after: page; padding-top: .08in; }
        .toc h2 { margin-top: 8px; font-size: 29px; border: 0; }
        .toc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; margin-top: 24px; }
        .toc-grid a { color: var(--navy); display: flex; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--border); text-decoration: none; font-size: 9px; font-weight: 650; }
        .toc-grid span { color: var(--gold-dark); font-size: 8px; font-weight: 800; }
        article > h2 { break-before: auto; margin-top: ${doc.compact ? '24px' : '32px'}; }
        article > h2:first-child { margin-top: 0; }
        h2 {
          color: var(--navy);
          font-size: ${doc.compact ? '18px' : '22px'};
          line-height: 1.16;
          letter-spacing: -.02em;
          margin: 0 0 18px;
          padding: 0 0 10px;
          border-bottom: 3px solid var(--gold);
          break-after: avoid;
        }
        h3 {
          color: var(--navy);
          font-size: ${doc.compact ? '12px' : '14px'};
          line-height: 1.25;
          margin: 22px 0 8px;
          break-after: avoid;
        }
        h4 { color: var(--gold-dark); font-size: 10px; margin: 18px 0 6px; break-after: avoid; }
        p { margin: 0 0 10px; orphans: 3; widows: 3; }
        ul, ol { margin: 4px 0 13px; padding-left: 22px; }
        li { margin: 0 0 5px; padding-left: 3px; }
        li::marker { color: var(--gold-dark); font-weight: 800; }
        strong { color: var(--navy); font-weight: 750; }
        blockquote {
          margin: 15px 0 18px;
          padding: 13px 16px;
          border-left: 4px solid var(--gold);
          background: var(--ivory);
          color: var(--navy);
          break-inside: avoid;
        }
        blockquote p { margin: 0; font-size: 10.5px; font-weight: 620; }
        code { color: var(--navy); background: #EEF1F3; padding: 1px 4px; border-radius: 3px; font-family: "SFMono-Regular", Consolas, monospace; font-size: .86em; }
        hr { border: 0; border-top: 1px solid var(--border); margin: 22px 0; }
        a { color: var(--gold-dark); text-decoration-color: rgba(138,104,0,.35); }
        .table-wrap { margin: 14px 0 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
        th { background: var(--navy); color: white; padding: 8px; text-align: left; font-weight: 700; }
        td { border: 1px solid var(--border); padding: 7px 8px; vertical-align: top; }
        tbody tr:nth-child(even) { background: #FBFAF7; }
        @page { size: Letter; margin: ${doc.compact ? '0.62in 0.62in 0.68in' : '0.7in 0.72in 0.72in'}; }
      </style>
    </head>
    <body>
      <section class="cover">
        <div class="brand-lockup">
          <img src="${logoDataUrl}" alt="">
          <div>
            <div class="brand-name">Saturn Star Moving</div>
            <div class="brand-sub">MISSION CONTROL</div>
          </div>
        </div>
        <div class="cover-main">
          <div class="eyebrow">${escapeHtml(doc.eyebrow)}</div>
          <h1>${escapeHtml(doc.title)}</h1>
          <div class="gold-rule"></div>
          <div class="subtitle">${escapeHtml(doc.subtitle)}</div>
        </div>
        <div class="cover-footer">
          <span><strong>${escapeHtml(doc.edition)}</strong></span>
          <span>Internal team document · Controlled copy</span>
        </div>
      </section>
      ${body}
    </body>
  </html>`
}

async function renderDocument(browser, doc, logoDataUrl) {
  const markdown = await fs.readFile(doc.source, 'utf8')
  const page = await browser.newPage()
  await page.setContent(documentHtml(doc, markdown, logoDataUrl), { waitUntil: 'load' })
  await page.emulateMedia({ media: 'print' })
  await page.pdf({
    path: doc.output,
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7px;color:#667085;padding:0 0.72in;display:flex;justify-content:space-between;">
      <span style="font-weight:700;color:#071421;">SATURN STAR MOVING</span>
      <span>${escapeHtml(doc.title)}</span>
    </div>`,
    footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7px;color:#667085;padding:0 0.72in;display:flex;justify-content:space-between;">
      <span>Internal operating document</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
    margin: {
      top: doc.compact ? '0.62in' : '0.7in',
      right: doc.compact ? '0.62in' : '0.72in',
      bottom: doc.compact ? '0.68in' : '0.72in',
      left: doc.compact ? '0.62in' : '0.72in',
    },
  })
  await page.close()
}

await fs.mkdir(outputDir, { recursive: true })
const logo = await fs.readFile(logoPath)
const logoDataUrl = `data:image/png;base64,${logo.toString('base64')}`
const browser = await chromium.launch({ headless: true })

try {
  for (const doc of documents) {
    await renderDocument(browser, doc, logoDataUrl)
    const stat = await fs.stat(doc.output)
    process.stdout.write(`${path.relative(root, doc.output)}\t${stat.size} bytes\n`)
  }
} finally {
  await browser.close()
}
