import { screen } from '@testing-library/react';
import { renderAt } from '../test/render';
import { PolicyScreen } from './PolicyScreen';

describe('PolicyScreen', () => {
  it.each([
    ['privacy', '개인정보처리방침'],
    ['terms', '이용약관'],
  ])('%s 문서를 보여준다', (doc, title) => {
    renderAt(`/policy/${doc}`, '/policy/:doc', <PolicyScreen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
  });

  it('없는 문서', () => {
    renderAt('/policy/nope', '/policy/:doc', <PolicyScreen />);
    expect(screen.getByText('문서를 찾을 수 없어요.')).toBeInTheDocument();
  });
});
