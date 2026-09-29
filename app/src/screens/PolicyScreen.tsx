import { useParams } from 'react-router-dom';
import aiNotice from '../../../docs/legal/ai-notice.md?raw';
import privacy from '../../../docs/legal/privacy-policy.md?raw';
import terms from '../../../docs/legal/terms-of-service.md?raw';
import { Page } from '../components/ui';
import { parseMarkdown, type Block } from '../lib/markdown';

const DOCS: Record<string, string> = { privacy, terms, ai: aiNotice };

function render(b: Block, i: number) {
  switch (b.type) {
    case 'heading':
      return b.level === 1 ? <h1 key={i}>{b.text}</h1> : <h2 key={i}>{b.text}</h2>;
    case 'list':
      return (
        <ul key={i}>
          {b.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <table key={i}>
          <thead>
            <tr>
              {b.header.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'paragraph':
      return <p key={i}>{b.text}</p>;
  }
}

export function PolicyScreen() {
  const { doc = '' } = useParams();
  const md = DOCS[doc];
  return (
    <Page>
      <article className="section policy">{md ? parseMarkdown(md).map(render) : <p>문서를 찾을 수 없어요.</p>}</article>
    </Page>
  );
}
