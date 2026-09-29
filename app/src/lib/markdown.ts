// docs/legal/*.md 를 앱 화면에 보여주기 위한 최소 마크다운 파서
// 지원: # 제목, - 목록, | 표 |, 문단, `코드`(일반 텍스트로), **굵게**(일반 텍스트로)

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'paragraph'; text: string };

export function inline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => inline(c.trim()));

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: inline(h[2]) });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]))
        items.push(inline(lines[i++].replace(/^\s*[-*]\s+/, '')));
      blocks.push({ type: 'list', items });
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\s*[-*]\s|\s*\|)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: 'paragraph', text: inline(para.join(' ')) });
  }
  return blocks;
}
