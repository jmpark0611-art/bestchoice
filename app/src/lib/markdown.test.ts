import privacy from '../../../docs/legal/privacy-policy.md?raw';
import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('제목, 목록, 표, 문단을 나눈다', () => {
    const blocks = parseMarkdown(
      '# 제목\n\n문단 **굵게** `코드`\n이어짐\n\n- 하나\n- 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: '제목' },
      { type: 'paragraph', text: '문단 굵게 코드 이어짐' },
      { type: 'list', items: ['하나', '둘'] },
      { type: 'table', header: ['a', 'b'], rows: [['1', '2']] },
    ]);
  });

  it('개인정보처리방침에 보관기간과 수탁자 표가 있다', () => {
    const blocks = parseMarkdown(privacy);
    const text = JSON.stringify(blocks);
    expect(text).toContain('2개월');
    expect(blocks.some((b) => b.type === 'table' && b.rows.some((r) => r[0].includes('OpenAI')))).toBe(true);
  });
});
