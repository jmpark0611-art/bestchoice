import type { MouseEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Poll } from '../lib/api';
import { errorMessage } from '../lib/errors';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="wrap">
      <main className="screen">{children}</main>
    </div>
  );
}

export function Brand({ onClick }: { onClick?: MouseEventHandler<HTMLAnchorElement> } = {}) {
  return (
    <Link to="/" className="brand" onClick={onClick}>
      결정해지니<b>Genie</b>
    </Link>
  );
}

export function Thinking({ text }: { text: string }) {
  return (
    <div className="thinking" role="status">
      <div className="lamp" aria-hidden>
        🧞
      </div>
      <h2>{text}</h2>
    </div>
  );
}

export function ErrorPanel({ code, onRetry }: { code: string; onRetry?: () => void }) {
  return (
    <div className="thinking" role="alert">
      <h2>{errorMessage(code)}</h2>
      {onRetry && (
        <button type="button" className="btn ghost" onClick={onRetry}>
          다시 시도
        </button>
      )}
      <Link to="/" className="btn text">
        처음으로
      </Link>
    </div>
  );
}

/** 한 줄 막대를 A와 B가 나눠 갖는다. 표가 없으면 반반으로 그린다 */
export function Tally({ poll }: { poll: Poll }) {
  const { a, b } = poll.votes ?? { a: 0, b: 0 };
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 50;
  return (
    <div className="tally">
      <div className="tally-head">
        <span className="a">{poll.a}</span>
        <span className="b">{poll.b}</span>
      </div>
      <div className="bar" role="img" aria-label={`${poll.a} ${a}표, ${poll.b} ${b}표`}>
        <div className="a" style={{ width: `${pa}%` }}>
          {a}표
        </div>
        <div className="b" style={{ width: `${100 - pa}%` }}>
          {b}표
        </div>
      </div>
    </div>
  );
}

export function CrisisPanel() {
  return (
    <>
      <h2>지금은 고르기보다 도움이 먼저예요</h2>
      <p className="lead">혼자 감당하지 않아도 돼요. 지금 바로 이야기할 수 있는 곳이 있어요.</p>
      <ul className="help">
        <li>
          자살예방상담전화 <a href="tel:109">109</a> (24시간)
        </li>
        <li>
          정신건강위기상담전화 <a href="tel:15770199">1577-0199</a>
        </li>
        <li>
          긴급한 위험이 있다면 <a href="tel:112">112</a> 또는 <a href="tel:119">119</a>
        </li>
      </ul>
    </>
  );
}

