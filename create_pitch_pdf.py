#!/usr/bin/env python3
"""Convert PITCH_DECK.md to a styled PDF."""
import markdown2
from weasyprint import HTML, CSS
import sys

with open("PITCH_DECK.md", "r") as f:
    md_content = f.read()

# Convert markdown to HTML
html_body = markdown2.markdown(
    md_content,
    extras=["tables", "fenced-code-blocks", "break-on-newline"]
)

# Style the PDF
style = CSS(string="""
    @page {
        size: A4;
        margin: 20mm;
        @top-center {
            content: "HACP — Hedera Agent Commerce Protocol";
            font-size: 9pt;
            color: #666;
        }
        @bottom-center {
            content: "Hello Future Apex 2026 | AI & Agents Track";
            font-size: 9pt;
            color: #666;
        }
    }
    body {
        font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
        font-size: 11pt;
        line-height: 1.6;
        color: #1a1a2e;
        max-width: 100%;
    }
    h1 {
        color: #4f46e5;
        font-size: 22pt;
        border-bottom: 3px solid #4f46e5;
        padding-bottom: 8px;
        margin-top: 0;
    }
    h2 {
        color: #4f46e5;
        font-size: 15pt;
        margin-top: 20px;
        border-left: 4px solid #4f46e5;
        padding-left: 10px;
        page-break-before: auto;
    }
    h3 {
        color: #6d28d9;
        font-size: 12pt;
    }
    hr {
        border: none;
        border-top: 1px solid #e0e0e0;
        margin: 16px 0;
        page-break-after: avoid;
    }
    code {
        background: #f3f4f6;
        padding: 1px 5px;
        border-radius: 3px;
        font-family: 'Courier New', monospace;
        font-size: 9.5pt;
    }
    pre {
        background: #1e1e2e;
        color: #cdd6f4;
        padding: 12px;
        border-radius: 6px;
        font-size: 8.5pt;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: 'Courier New', monospace;
    }
    pre code {
        background: none;
        padding: 0;
        color: inherit;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        margin: 12px 0;
    }
    th {
        background: #4f46e5;
        color: white;
        padding: 8px 12px;
        text-align: left;
        font-size: 10pt;
    }
    td {
        padding: 7px 12px;
        border-bottom: 1px solid #e0e0e0;
        font-size: 10pt;
    }
    tr:nth-child(even) td {
        background: #f8f9ff;
    }
    ul, ol {
        margin: 8px 0;
        padding-left: 20px;
    }
    li {
        margin: 4px 0;
    }
    strong {
        color: #1a1a2e;
    }
    blockquote {
        border-left: 4px solid #4f46e5;
        margin: 10px 0;
        padding: 8px 16px;
        background: #f8f9ff;
        border-radius: 0 6px 6px 0;
        color: #4f46e5;
        font-style: italic;
    }
""")

html_full = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>HACP Pitch Deck</title></head>
<body>{html_body}</body>
</html>"""

html = HTML(string=html_full)
html.write_pdf("PITCH_DECK.pdf", stylesheets=[style])
print("✅ PITCH_DECK.pdf created")
