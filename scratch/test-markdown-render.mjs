import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import assert from 'node:assert';

console.log('🧪 Testing Markdown Table & Break Rendering...\n');

// テスト用コンポーネント定義（ChatMessage.tsx と同等の設定）
function TestMarkdownRenderer({ content }) {
  return React.createElement(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm, remarkBreaks],
      components: {
        table: ({ node, ...props }) =>
          React.createElement(
            'div',
            { className: 'overflow-x-auto my-2.5 max-w-full rounded-xl border border-slate-800 bg-slate-950/40 shadow-inner' },
            React.createElement('table', { className: 'w-full text-left border-collapse', ...props })
          ),
        thead: ({ node, ...props }) =>
          React.createElement('thead', { className: 'bg-slate-800/80 border-b border-slate-700/80 text-slate-200', ...props }),
        tbody: ({ node, ...props }) =>
          React.createElement('tbody', { className: 'divide-y divide-slate-800/60', ...props }),
        tr: ({ node, ...props }) =>
          React.createElement('tr', { className: 'hover:bg-slate-800/30 transition-colors', ...props }),
        th: ({ node, ...props }) =>
          React.createElement('th', { className: 'px-3.5 py-2 text-[0.88em] font-semibold text-slate-200 whitespace-nowrap border-r border-slate-800/60 last:border-r-0', ...props }),
        td: ({ node, ...props }) =>
          React.createElement('td', { className: 'px-3.5 py-2 text-[0.85em] text-slate-300 leading-relaxed border-r border-slate-800/40 last:border-r-0', ...props }),
        del: ({ node, ...props }) =>
          React.createElement('del', { className: 'line-through text-slate-500', ...props }),
      },
    },
    content
  );
}

// 1. テーブルレンダリングの検証
const tableMarkdown = `
前置きのテキストです。

| 項目名 | 型 | 説明 |
| :--- | :--- | :--- |
| id | string | 一意な識別子 |
| count | number | 回数 |
| active | boolean | 有効フラグ |

後続のテキストです。
`;

const tableHtml = renderToString(React.createElement(TestMarkdownRenderer, { content: tableMarkdown }));

console.log('--- Rendered Table HTML Snippet ---');
console.log(tableHtml);
console.log('------------------------------------\n');

assert(tableHtml.includes('<table'), 'FAIL: table tag should be present');
assert(tableHtml.includes('<thead'), 'FAIL: thead tag should be present');
assert(tableHtml.includes('<tbody'), 'FAIL: tbody tag should be present');
assert(tableHtml.includes('<th'), 'FAIL: th tag should be present');
assert(tableHtml.includes('<td'), 'FAIL: td tag should be present');
assert(tableHtml.includes('overflow-x-auto'), 'FAIL: overflow-x-auto wrapper should be present for mobile scrolling');
assert(tableHtml.includes('一意な識別子'), 'FAIL: table content should be rendered');
console.log('✅ PASS: Markdown Table rendering verified successfully!');

// 2. 単一改行（remark-breaks）の検証
const breakMarkdown = `1行目のテキスト
2行目のテキスト
3行目のテキスト`;

const breakHtml = renderToString(React.createElement(TestMarkdownRenderer, { content: breakMarkdown }));

console.log('\n--- Rendered Breaks HTML Snippet ---');
console.log(breakHtml);
console.log('-------------------------------------\n');

assert(breakHtml.includes('<br/>') || breakHtml.includes('<br>'), 'FAIL: <br> tag should be present for soft line breaks');
assert(breakHtml.includes('1行目のテキスト'), 'FAIL: line 1 should be present');
assert(breakHtml.includes('2行目のテキスト'), 'FAIL: line 2 should be present');
console.log('✅ PASS: Soft line break rendering (<br>) verified successfully!');

// 3. 取り消し線（GFM del）の検証
const delMarkdown = `これは ~~古い価格~~ 新しい価格です。`;
const delHtml = renderToString(React.createElement(TestMarkdownRenderer, { content: delMarkdown }));
assert(delHtml.includes('<del'), 'FAIL: <del> tag should be present for strikethrough');
console.log('✅ PASS: GFM strikethrough (~~del~~) verified successfully!\n');

console.log('🎉 ALL RENDER TESTS PASSED!');
