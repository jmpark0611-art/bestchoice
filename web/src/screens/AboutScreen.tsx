import { Link } from 'react-router-dom';
import { Brand, Screen } from '../components/ui';

/** 지인 시험용 웹 버전의 이용 안내. 정식 출시 전에 개인정보처리방침·이용약관 전문으로 바꾼다 */
export function AboutScreen() {
  return (
    <Screen>
      <Brand />
      <h2>이용 안내</h2>
      <ul className="help">
        <li>적은 두 선택지와 상황 한 줄은 결론을 만들기 위해 외부 AI 서비스(OpenAI)로 전송돼요.</li>
        <li>이름, 연락처, 계좌·건강 정보 같은 민감한 개인정보는 적지 마세요.</li>
        <li>투표 링크를 받은 사람은 두 선택지와 상황 한 줄을 볼 수 있어요. 누가 어디에 투표했는지는 저장하지만 이름은 수집하지 않아요.</li>
        <li>결론은 판단을 돕는 참고용이에요. 의료·법률·투자처럼 중요한 결정은 전문가와 확인하세요.</li>
        <li>기록은 만든 날부터 2개월 뒤 자동으로 삭제돼요.</li>
        <li>운영: 에스제이컴퍼니 · 대표 박지민 · 문의 jmpark0611@gmail.com</li>
      </ul>
      <div className="grow" />
      <Link to="/" className="btn ghost">
        돌아가기
      </Link>
    </Screen>
  );
}
