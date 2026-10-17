import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * High-performance, zero-dependency Markdown renderer for NDC AI Assistant
 * Converts bold, italics, tables, lists, blockquotes, and code to styled Tailwind JSX.
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split content into blocks (paragraphs, tables, lists, headers)
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[] = [];
  let inTable = false;
  let inList = false;
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' = 'ul';

  const flushList = (key: string) => {
    if (listItems.length > 0) {
      if (listType === 'ul') {
        elements.push(
          <ul key={key} className="my-2 space-y-1 list-disc list-inside text-inherit">
            {listItems.map((item, i) => (
              <li key={i} className="leading-relaxed">
                {parseInlineFormatting(item)}
              </li>
            ))}
          </ul>
        );
      } else {
        elements.push(
          <ol key={key} className="my-2 space-y-1 list-decimal list-inside text-inherit">
            {listItems.map((item, i) => (
              <li key={i} className="leading-relaxed">
                {parseInlineFormatting(item)}
              </li>
            ))}
          </ol>
        );
      }
      listItems = [];
      inList = false;
    }
  };

  const flushTable = (key: string) => {
    if (tableRows.length >= 2) {
      const headerRow = tableRows[0];
      const dataRows = tableRows.slice(1).filter((r) => !r.match(/^\|?\s*[-:]+[-| :]*$/));

      const parseCells = (row: string) =>
        row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseCells(headerRow);

      elements.push(
        <div key={key} className="my-3 overflow-x-auto rounded-lg border border-slate-200 shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 font-semibold border-b border-slate-200">
                {headers.map((h, i) => (
                  <th key={i} className="py-2 px-3 whitespace-nowrap">
                    {parseInlineFormatting(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {dataRows.map((row, rIdx) => {
                const cells = parseCells(row);
                return (
                  <tr key={rIdx} className="hover:bg-slate-50/70 transition-colors">
                    {cells.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2 px-3 whitespace-nowrap text-slate-800">
                        {parseInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();

    // 1. Table Detection (starts and ends with | or contains | )
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (inList) flushList(`list-${idx}`);
      inTable = true;
      tableRows.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable(`table-${idx}`);
    }

    // 2. Unordered List Detection
    if (trimmed.match(/^[-*•]\s+/)) {
      if (inTable) flushTable(`table-${idx}`);
      if (!inList) {
        inList = true;
        listType = 'ul';
      }
      listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
      continue;
    }

    // 3. Ordered List Detection
    if (trimmed.match(/^\d+\.\s+/)) {
      if (inTable) flushTable(`table-${idx}`);
      if (!inList) {
        inList = true;
        listType = 'ol';
      }
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      continue;
    }

    // If we were in a list and hit a normal line, flush it
    if (inList) {
      flushList(`list-${idx}`);
    }

    // 4. Empty line
    if (!trimmed) {
      elements.push(<div key={`spacer-${idx}`} className="h-1.5" />);
      continue;
    }

    // 5. Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={`h3-${idx}`} className="text-sm font-bold text-slate-900 mt-2 mb-1 flex items-center gap-1.5">
          {parseInlineFormatting(trimmed.slice(4))}
        </h4>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h2-${idx}`} className="text-base font-extrabold text-slate-900 mt-2.5 mb-1">
          {parseInlineFormatting(trimmed.slice(3))}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={`h1-${idx}`} className="text-lg font-black text-slate-900 mt-3 mb-1.5">
          {parseInlineFormatting(trimmed.slice(2))}
        </h2>
      );
      continue;
    }

    // 6. Blockquotes
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote
          key={`quote-${idx}`}
          className="border-l-4 border-indigo-400 bg-indigo-50/60 pl-3 py-1.5 my-2 rounded-r-md text-xs text-indigo-900 italic"
        >
          {parseInlineFormatting(trimmed.slice(2))}
        </blockquote>
      );
      continue;
    }

    // 7. Standard Paragraph
    elements.push(
      <p key={`p-${idx}`} className="my-1 leading-relaxed">
        {parseInlineFormatting(rawLine)}
      </p>
    );
  }

  // Flush any remaining tables or lists at end
  if (inTable) flushTable('table-end');
  if (inList) flushList('list-end');

  return <div className={`markdown-body space-y-1 ${className}`}>{elements}</div>;
};

/**
 * Parses inline formatting: **bold**, *italic*, `code`, and symbols
 */
function parseInlineFormatting(text: string): React.ReactNode {
  if (!text) return null;

  // Split by bold (**...**) and inline code (`...`) and italic (*...*)
  // Regex matches **bold**, `code`, *italic*
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Push preceding text
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${match.index}`} className="font-bold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`c-${match.index}`}
          className="px-1.5 py-0.5 rounded bg-slate-100 text-indigo-700 font-mono text-[11px] border border-slate-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={`i-${match.index}`} className="italic text-slate-700">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      parts.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return <>{parts}</>;
}
