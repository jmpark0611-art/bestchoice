import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Screen } from '../components/ui';
import { LEGAL_CONTACT, LEGAL_DOCUMENTS, type LegalDocumentKind } from '../legal/legalContent';

export function LegalInfoScreen({ document }: { document: LegalDocumentKind }) {
  const content = LEGAL_DOCUMENTS[document];
  const title = useRef<HTMLHeadingElement>(null);

  // The same component serves both routes; announce the newly opened document.
  useEffect(() => { title.current?.focus(); }, [document]);

  return (
    <Screen>
      <Brand />
      <Link to="/about" className="legal-back">이용 안내로 돌아가기</Link>
      <article className="legal-document" aria-labelledby="legal-title">
        <header className="legal-heading">
          <h1 id="legal-title" ref={title} tabIndex={-1}>{content.title}</h1>
          <p>{content.introduction}</p>
        </header>
        <aside className="legal-review" aria-labelledby="legal-review-title">
          <h2 id="legal-review-title">정식 공개 전 검토본</h2>
          <p>{content.reviewNote}</p>
        </aside>
        {content.sections.map(section => (
          <section className="legal-section" key={section.id} aria-labelledby={`legal-${section.id}`}>
            <h2 id={`legal-${section.id}`}>{section.title}</h2>
            {section.steps ? <ol className="legal-steps">
              {section.steps.map(step => <li key={step}>{step}</li>)}
            </ol> : null}
            {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            {section.facts ? <dl className="legal-facts">
              {section.facts.map(fact => <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.detail}</dd>
              </div>)}
            </dl> : null}
          </section>
        ))}
        <section className="legal-contact" aria-labelledby="legal-contact-title">
          <h2 id="legal-contact-title">운영 및 개인정보 문의</h2>
          <p>{LEGAL_CONTACT.operator} · 대표 {LEGAL_CONTACT.representative}</p>
          <p className="legal-contact-address">{LEGAL_CONTACT.email}</p>
          <a className="btn ghost" aria-describedby="legal-mail-help"
            href={`mailto:${LEGAL_CONTACT.email}?subject=${encodeURIComponent(content.contactSubject)}`}>
            {content.contactLabel}
          </a>
          <p id="legal-mail-help">메일 앱이 열리지 않으면 위 주소를 복사해 사용 중인 이메일에서 문의해 주세요. 메일은 직접 보내야 하며, 작성 화면을 열어도 문의 전송이나 삭제가 완료되지 않아요.</p>
        </section>
        <nav className="legal-links" aria-label="관련 안내">
          <Link to={content.relatedPath} className="btn ghost">{content.relatedLabel}</Link>
          <Link to="/about" className="btn ghost">이용 안내와 기록 관리</Link>
        </nav>
      </article>
    </Screen>
  );
}
