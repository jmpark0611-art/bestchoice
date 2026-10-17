import { Button, Loader, Top } from '@toss/tds-mobile';
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, RETRYABLE } from '../lib/errors';

export function Page({ children }: { children: ReactNode }) {
  return <main className="page"><div className="page-inner">{children}</div></main>;
}

export function PageTop({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Top
      title={<Top.TitleParagraph><span className="display">{title}</span></Top.TitleParagraph>}
      subtitleBottom={subtitle ? <Top.SubtitleParagraph>{subtitle}</Top.SubtitleParagraph> : undefined}
    />
  );
}

export function Gap({ size = 16 }: { size?: 8 | 16 | 24 }) {
  return <div className={`gap-${size}`} />;
}

export function Card({ title, children, highlight }: { title?: string; children: ReactNode; highlight?: boolean }) {
  return (
    <section className={highlight ? 'card highlight' : 'card'}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

/** 여러 문구를 주면 기다리는 동안 하나씩 바꿔 보여준다 */
export function LoadingView({ message }: { message: string | string[] }) {
  const messages = Array.isArray(message) ? message : [message];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, messages.length - 1)), 2500);
    return () => clearInterval(timer);
  }, [messages.length]);
  return (
    <div className="center" role="status" aria-live="polite">
      <Loader />
      <p className="muted">{messages[index]}</p>
    </div>
  );
}

export function ErrorView({ code, onRetry, onHome }: { code: string; onRetry?: () => void; onHome?: () => void }) {
  return (
    <div className="center" role="alert">
      <p className="big">{errorMessage(code)}</p>
      {onRetry && RETRYABLE.has(code) && (
        <Button display="block" onClick={onRetry}>
          다시 시도하기
        </Button>
      )}
      {onHome && (
        <Button display="block" variant="weak" onClick={onHome}>
          처음으로
        </Button>
      )}
    </div>
  );
}
