import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// mTLS 연결 테스트 전용 함수 (확인 후 삭제 예정)
// 인증서/키 내용은 절대 응답에 포함하지 않음

function loadPem(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  let v = raw.trim();
  // base64로 넣은 경우 디코딩
  if (!v.includes("-----BEGIN")) {
    try {
      v = new TextDecoder().decode(
        Uint8Array.from(atob(v.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
      );
    } catch {
      return null;
    }
  }
  // \n 문자열로 들어간 경우 실제 줄바꿈으로
  return v.replace(/\\n/g, "\n");
}

Deno.serve(async () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const cert = loadPem("TOSS_MTLS_CERT");
  const key = loadPem("TOSS_MTLS_KEY");

  if (!cert || !key) {
    return json({
      step: "secrets",
      ok: false,
      cert_found: !!cert,
      key_found: !!key,
      hint: "Edge Functions > Secrets에 TOSS_MTLS_CERT, TOSS_MTLS_KEY를 넣어주세요.",
    }, 400);
  }

  let client: Deno.HttpClient;
  try {
    // deno-lint-ignore no-explicit-any
    client = (Deno as any).createHttpClient({ cert, key });
  } catch (e) {
    return json({ step: "client", ok: false, error: String(e) }, 500);
  }

  // 가짜 인가코드로 로그인 토큰 발급 호출
  // TLS 핸드셰이크만 통과하면 토스가 JSON(FAIL 등)으로 응답함 = mTLS 성공
  try {
    const res = await fetch(
      "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizationCode: "mtls-test", referrer: "DEFAULT" }),
        client,
      } as RequestInit,
    );
    const text = await res.text();
    return json({
      step: "toss_api",
      mtls_ok: true,
      http_status: res.status,
      toss_response: text.slice(0, 500),
      note: "토스 서버가 응답했다면 mTLS 연결 성공. 가짜 코드라 FAIL 응답은 정상.",
    });
  } catch (e) {
    return json({
      step: "toss_api",
      mtls_ok: false,
      error: String(e),
      note: "TLS 단계에서 실패. 인증서/키 짝, 앱 선택, 파일 형식을 확인하세요.",
    }, 502);
  } finally {
    client.close();
  }
});
