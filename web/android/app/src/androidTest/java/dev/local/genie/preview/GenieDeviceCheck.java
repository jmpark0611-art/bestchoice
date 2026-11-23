package dev.local.genie.preview;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.accessibilityservice.AccessibilityService;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructPollfd;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TestWatcher;
import org.junit.runner.Description;
import org.junit.runner.RunWith;

/**
 * Run ONLY through scripts/android-device-check.mjs in its network namespace.
 * These methods intentionally run in separate instrumentation processes. The
 * host force-stops the fixture app between them, without clearing its data.
 * No API is mocked in the app; no decision button or remote URL is activated.
 */
@RunWith(AndroidJUnit4.class)
public class GenieDeviceCheck {
    private static final String APP_ID = "dev.local.genie.preview";
    private static final String A = "기기 검증 A";
    private static final String B = "기기 검증 B";
    private static final String NOTE = "임시 기기 검증 초안";
    private static final String DRAFT_KEY = "genie:decision-drafts:v1";
    private static final String ABOUT_LINK = "a#home-draft-settings-link[href=\"/about\"]";
    private static final String ABOUT_CLICK = "(() => {const events=window.__genieTapEvents;"
        + "return Array.isArray(events)?events.find(e=>e.type==='click' && e.trusted===true"
        + " && e.anchorId==='home-draft-settings-link' && e.anchorPath==='/about')??null:null;})()";
    private static final String ABOUT_RENDERED = "(() => {const h=document.querySelector('h2#about-title');"
        + "if(!h || h.textContent.trim()!=='이용 안내')return false;"
        + "const r=h.getBoundingClientRect(),s=getComputedStyle(h);"
        + "return r.width>0 && r.height>0 && s.visibility==='visible' && Number(s.opacity)>0;})()";
    private static final String DRAFT_STATE = "(() => {const s={"
        + "origin:location.origin==='https://localhost'?'https://localhost':'unexpected',"
        + "path:location.pathname.slice(0,80),readyState:document.readyState,"
        + "promptPresent:!!document.querySelector('[aria-label=\"이전 결정 초안\"]'),"
        + "formPresent:!!document.getElementById('in-a') && !!document.getElementById('in-b') && !!document.getElementById('in-note'),"
        + "storageReadable:false,draftKeyPresent:false,parseable:false,versionValid:false,homePresent:false,"
        + "expectedFieldsMatch:{a:false,b:false,note:false},preferenceState:'unknown',"
        + "revisionValid:false,updatedAtValid:false,ageMs:null};"
        + "try {const raw=localStorage.getItem(" + JSONObject.quote(DRAFT_KEY) + ");s.storageReadable=true;"
        + "s.draftKeyPresent=raw!==null;if(raw===null){s.preferenceState='default-enabled';return s;}"
        + "let d;try{d=JSON.parse(raw);s.parseable=true;}catch{return s;}"
        + "if(!d || typeof d!=='object' || Array.isArray(d))return s;"
        + "s.versionValid=d.version===1;s.preferenceState=typeof d.enabled==='boolean'?(d.enabled?'enabled':'disabled'):'invalid';"
        + "s.homePresent=!!d.home && typeof d.home==='object' && !Array.isArray(d.home);"
        + "if(s.homePresent){const h=d.home,now=Date.now();"
        + "s.expectedFieldsMatch={a:h.a===" + JSONObject.quote(A) + ",b:h.b===" + JSONObject.quote(B)
        + ",note:h.note===" + JSONObject.quote(NOTE) + "};"
        + "s.revisionValid=typeof h.revision==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(h.revision);"
        + "s.updatedAtValid=Number.isSafeInteger(h.updatedAt) && h.updatedAt>=0 && h.updatedAt<=now+300000;"
        + "if(Number.isSafeInteger(h.updatedAt) && Number.isSafeInteger(now-h.updatedAt))s.ageMs=now-h.updatedAt;"
        + "}return s;}catch{return s;}})()";
    private Instrumentation instrumentation;
    private MainActivity activity;

    @Rule
    public final TestWatcher failureScreenshot = new TestWatcher() {
        @Override
        protected void failed(Throwable originalFailure, Description description) {
            // Capture while the failed Activity still exists; the runner may
            // finish it before host-side adb receives the instrumentation result.
            if (instrumentation == null || activity == null) return;
            try {
                UiAutomation automation = instrumentation.getUiAutomation();
                if (automation == null) return;
                try (ParcelFileDescriptor output = automation.executeShellCommand(
                        "screencap -p /data/local/tmp/genie-device-failure.png")) {
                    StructPollfd pipe = new StructPollfd();
                    pipe.fd = output.getFileDescriptor();
                    pipe.events = (short) (OsConstants.POLLIN | OsConstants.POLLHUP);
                    if (Os.poll(new StructPollfd[] {pipe}, 5_000) > 0
                        && (pipe.revents & OsConstants.POLLHUP) != 0) {
                        Bundle status = new Bundle();
                        status.putString("stream", "\nGENIE_FAILURE_SCREENSHOT_BEFORE_TEST_EXIT\n");
                        instrumentation.sendStatus(2, status);
                    }
                }
            } catch (Exception ignored) {
                // Keep the original assertion. The host validates any image and
                // records capture failure separately; no test is turned into PASS.
            }
        }
    };

    private void launch() {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        assertEquals("The test may only launch the fixed fixture identity", APP_ID,
            instrumentation.getTargetContext().getPackageName());
        assertTrue("A release APK must never be used by this fixture test",
            (instrumentation.getTargetContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        assertEquals("The approved emulator image is API 36", 36, Build.VERSION.SDK_INT);
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(intent);
        assertNotNull(activity);
        instrumentation.waitForIdleSync();
    }

    private String evaluate(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            try {
                assertNotNull("Capacitor bridge is missing", activity.getBridge());
                WebView webView = activity.getBridge().getWebView();
                assertNotNull("The real app WebView is missing", webView);
                webView.evaluateJavascript(expression, value -> { result.set(value); done.countDown(); });
            } catch (Throwable error) { failure.set(error); done.countDown(); }
        });
        assertTrue("WebView did not answer in time", done.await(8, TimeUnit.SECONDS));
        if (failure.get() != null) throw new AssertionError("WebView evaluation failed", failure.get());
        return result.get();
    }

    private void awaitTrue(String expression, String reason) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000;
        do {
            if ("true".equals(evaluate(expression))) return;
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError(reason);
    }

    private AssertionError navigationFailure(AssertionError original, String context, boolean includeNativeState) {
        String observed = "unavailable", nativeState = "not-requested";
        try {
            observed = evaluate("({path:location.pathname.slice(0,80),activation:navigator.userActivation.hasBeenActive,"
                + "aboutRendered:" + ABOUT_RENDERED + ",events:Array.isArray(window.__genieTapEvents)"
                + "?window.__genieTapEvents.slice(0,4):[]})");
        } catch (Exception | AssertionError diagnosticFailure) {
            if (diagnosticFailure instanceof InterruptedException) Thread.currentThread().interrupt();
            original.addSuppressed(diagnosticFailure);
        }
        if (includeNativeState) {
            try {
                nativeState = String.valueOf(nativeBackState());
            } catch (Exception | AssertionError diagnosticFailure) {
                original.addSuppressed(diagnosticFailure);
                nativeState = "unavailable";
            }
        }
        // Evidence is best effort. Its failure must never hide the stage that
        // failed or turn a missing touch, route, render, or Back into a pass.
        return new AssertionError(original.getMessage() + "; " + context
            + "; observed=" + observed + "; nativeState=" + nativeState, original);
    }

    private String draftState(String phase, AssertionError original) {
        try {
            // Only schema/fixture-match flags and relative age leave the WebView.
            // Never log raw storage, draft text, revisions, or unexpected origins.
            return new JSONObject(evaluate(DRAFT_STATE)).put("phase", phase).toString();
        } catch (Exception | AssertionError diagnosticFailure) {
            if (diagnosticFailure instanceof InterruptedException) Thread.currentThread().interrupt();
            if (original != null) original.addSuppressed(diagnosticFailure);
            return "{\"phase\":" + JSONObject.quote(phase) + ",\"captureError\":\"DRAFT_STATE_UNAVAILABLE\"}";
        }
    }

    private void report(String caseId, JSONObject evidence) throws Exception {
        evidence.put("caseId", caseId).put("passed", true);
        Bundle status = new Bundle();
        status.putString("stream", "\nGENIE_DEVICE_CASE " + evidence.toString() + "\n");
        instrumentation.sendStatus(2, status);
    }

    private JSONObject nativeBackState() throws Exception {
        AtomicReference<JSONObject> state = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            try {
                WebView webView = activity.getBridge().getWebView();
                WebBackForwardList history = webView.copyBackForwardList();
                state.set(new JSONObject().put("focused", activity.hasWindowFocus())
                    .put("finishing", activity.isFinishing()).put("destroyed", activity.isDestroyed())
                    .put("canGoBack", webView.canGoBack()).put("historyIndex", history.getCurrentIndex())
                    .put("historySize", history.getSize()));
            } catch (Exception error) { failure.set(error); }
        });
        if (failure.get() != null) throw failure.get();
        return state.get();
    }

    private JSONObject awaitNativeBackReady() throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000;
        JSONObject state;
        do {
            state = nativeBackState();
            if (state.getBoolean("focused") && state.getBoolean("canGoBack")
                && !state.getBoolean("finishing") && !state.getBoolean("destroyed")) return state;
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Native Back input/history was not ready: " + state);
    }

    private JSONObject layout() throws Exception {
        awaitTrue("document.fonts.status === 'loaded'", "Local fonts did not finish loading");
        JSONObject measured = new JSONObject(evaluate("(() => {"
            + "const width=window.innerWidth; const controls=[...document.querySelectorAll('input,button,a')];"
            + "const visible=controls.map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);"
            + "return {width,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),"
            + "visibleControls:visible.length,outside:visible.filter(r=>r.left < -1 || r.right > width+1).length,"
            + "devicePixelRatio:window.devicePixelRatio};})()"));
        assertEquals("The app must actually be measured at 320 CSS pixels", 320, measured.getInt("width"));
        assertTrue("The page overflows the narrow viewport", measured.getInt("scrollWidth") <= 321);
        assertTrue("Expected visible Home form controls", measured.getInt("visibleControls") >= 8);
        assertEquals("A visible control extends outside the narrow viewport", 0, measured.getInt("outside"));
        return measured;
    }

    private void enter(String id, String value) throws Exception {
        String expression = "(() => { const input=document.getElementById(" + JSONObject.quote(id) + ");"
            + "if(!input)return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,"
            + JSONObject.quote(value) + "); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()";
        assertEquals("Synthetic form input was not dispatched", "true", evaluate(expression));
        instrumentation.waitForIdleSync();
    }

    private JSONObject tapWebElement(String selector) throws Exception {
        String target = "document.querySelector(" + JSONObject.quote(selector) + ")";
        awaitTrue("document.fonts.status==='loaded'", "Fonts were not ready before system touch");
        assertEquals("The touch target is missing", "true", evaluate("(() => {const e=" + target
            + ";if(!e)return false;e.scrollIntoView({behavior:'instant',block:'center',inline:'center'});"
            + "window.__genieTapReady=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__genieTapReady=true));"
            + "return true;})()"));
        awaitTrue("window.__genieTapReady===true", "The scrolled touch target did not finish rendering");
        awaitTrue("(() => {const e=" + target + ";if(!e)return false;const r=e.getBoundingClientRect();"
            + "return r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth"
            + " && r.top>=0 && r.bottom<=innerHeight;})()", "The touch target is not fully visible");
        JSONObject css = new JSONObject(evaluate("(() => {const e=" + target + ",r=e.getBoundingClientRect();"
            + "const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);"
            + "return {x,y,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,"
            + "left:r.left,top:r.top,right:r.right,bottom:r.bottom,hit:hit===e||e.contains(hit)};})()"));
        assertTrue("Another element covers the touch target", css.getBoolean("hit"));
        double cssX = css.getDouble("x"), cssY = css.getDouble("y");
        double cssWidth = css.getDouble("width"), cssHeight = css.getDouble("height");
        AtomicReference<float[]> point = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            WebView webView = activity.getBridge().getWebView();
            if (!activity.hasWindowFocus() || webView.getWidth() <= 0 || webView.getHeight() <= 0) return;
            int[] origin = new int[2];
            webView.getLocationOnScreen(origin);
            float scaleX = (float) (webView.getWidth() / cssWidth);
            float scaleY = (float) (webView.getHeight() / cssHeight);
            point.set(new float[] {(float) (origin[0] + cssX * scaleX),
                (float) (origin[1] + cssY * scaleY), scaleX, scaleY, origin[0], origin[1],
                webView.getScrollX(), webView.getScrollY()});
        });
        float[] nativePoint = point.get();
        assertNotNull("The app WebView is not ready for system touch", nativePoint);
        assertTrue("CSS/native coordinate scales disagree", nativePoint[2] > 0
            && Math.abs(nativePoint[2] - nativePoint[3]) < 0.02f);
        JSONObject plan = new JSONObject().put("css", css).put("screenX", nativePoint[0])
            .put("screenY", nativePoint[1]).put("scaleX", nativePoint[2]).put("scaleY", nativePoint[3])
            .put("originX", nativePoint[4]).put("originY", nativePoint[5])
            .put("nativeScrollX", nativePoint[6]).put("nativeScrollY", nativePoint[7]);
        // Temporary instrumentation-only trace: no input values, body text,
        // URL queries, local storage, or production code is recorded/changed.
        assertEquals("The bounded touch trace could not be installed", "true", evaluate("(() => {"
            + "window.__genieTapEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','click']){"
            + "document.addEventListener(type,e=>{if(window.__genieTapEvents.length>=4)return;"
            + "const t=e.target instanceof Element?e.target:null,a=t?.closest('a');"
            + "window.__genieTapEvents.push({type:e.type,trusted:e.isTrusted,tag:t?.tagName??'',"
            + "id:(t?.id??'').slice(0,40),anchorId:(a?.id??'').slice(0,40),"
            + "anchorPath:a?new URL(a.href).pathname.slice(0,80):null,"
            + "x:e.clientX,y:e.clientY});},{capture:true,once:true,passive:true});}return true;})()"));
        long downAt = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(downAt, downAt, MotionEvent.ACTION_DOWN, nativePoint[0], nativePoint[1], 0);
        MotionEvent up = null;
        try {
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            instrumentation.sendPointerSync(down);
            SystemClock.sleep(50);
            up = MotionEvent.obtain(downAt, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, nativePoint[0], nativePoint[1], 0);
            up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            instrumentation.sendPointerSync(up);
        } finally {
            down.recycle();
            if (up != null) up.recycle();
        }
        instrumentation.waitForIdleSync();
        return plan;
    }

    private String valuesMatch() {
        return "(() => { const a=document.getElementById('in-a'),b=document.getElementById('in-b'),"
            + "n=document.getElementById('in-note'); return !!a && !!b && !!n && a.value===" + JSONObject.quote(A)
            + " && b.value===" + JSONObject.quote(B) + " && n.value===" + JSONObject.quote(NOTE) + "; })()";
    }

    @Test
    public void launchBackNarrowAndPrepareDraft() throws Exception {
        launch();
        awaitTrue("location.origin==='https://localhost' && location.pathname==='/' && !!document.getElementById('in-a')",
            "The packaged Home screen did not launch at the local Capacitor origin");
        assertEquals("A fresh installation should not contain an earlier draft", "true",
            evaluate("localStorage.getItem(" + JSONObject.quote(DRAFT_KEY) + ")===null"));
        PackageInfo webView = WebView.getCurrentWebViewPackage();
        assertNotNull("System WebView package is unavailable", webView);
        report("launch", new JSONObject().put("origin", "https://localhost").put("apiLevel", Build.VERSION.SDK_INT)
            .put("webViewPackage", webView.packageName).put("webViewVersion", webView.versionName));

        // A real OS touch supplies user activation. A synthetic JS click makes
        // Chromium skip the resulting history entry in native Back navigation.
        JSONObject aboutTap = tapWebElement(ABOUT_LINK);
        try {
            awaitTrue("(" + ABOUT_CLICK + ")!==null",
                "ABOUT_TOUCH_NOT_DELIVERED: the About link did not receive a trusted click");
            aboutTap.put("trustedClick", new JSONObject(evaluate(ABOUT_CLICK)));
            awaitTrue("location.pathname==='/about'", "ABOUT_ROUTE_TIMEOUT: the About route did not open");
            awaitTrue(ABOUT_RENDERED, "ABOUT_RENDER_TIMEOUT: the About heading did not render");
            assertEquals("ABOUT_USER_ACTIVATION_MISSING: the About link did not activate the document", "true",
                evaluate("navigator.userActivation.hasBeenActive"));
        } catch (AssertionError failure) {
            throw navigationFailure(failure, "planned=" + aboutTap, false);
        }
        UiAutomation automation = instrumentation.getUiAutomation();
        assertNotNull("Android system UI automation is unavailable", automation);
        JSONObject beforeBack = awaitNativeBackReady();
        // Exercise the OS Back action once; never invoke the app's dispatcher,
        // WebView.goBack or JavaScript history directly as a passing fallback.
        assertTrue("The Android system rejected the Back action: " + beforeBack,
            automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK));
        try {
            awaitTrue("location.pathname==='/' && !!document.getElementById('in-a')",
                "NATIVE_BACK_TIMEOUT: Native Android Back did not return Home");
        } catch (AssertionError failure) {
            throw navigationFailure(failure, "before=" + beforeBack, true);
        }
        report("native-back", new JSONObject().put("from", "/about").put("to", "/")
            .put("systemAction", "GLOBAL_ACTION_BACK").put("before", beforeBack).put("aboutTap", aboutTap));
        report("narrow-screen", layout());

        enter("in-a", A); enter("in-b", B); enter("in-note", NOTE);
        awaitTrue(valuesMatch(), "React did not retain the synthetic input events");
        awaitTrue("(() => { const raw=localStorage.getItem(" + JSONObject.quote(DRAFT_KEY) + ");"
            + "if(!raw)return false;const d=JSON.parse(raw);return d.version===1 && !!d.home && d.home.a==="
            + JSONObject.quote(A) + " && d.home.b===" + JSONObject.quote(B) + " && d.home.note===" + JSONObject.quote(NOTE)
            + " && typeof d.home.revision==='string'; })()", "The real draft autosave did not persist the current form");
        assertFalse("A decision must not have started", "true".equals(evaluate("location.pathname!=='/'")));
        Bundle draftStatus = new Bundle();
        draftStatus.putString("stream", "\nGENIE_DRAFT_STATE " + draftState("prepared", null) + "\n");
        try {
            instrumentation.sendStatus(2, draftStatus);
        } catch (RuntimeException ignored) {
            // Diagnostic delivery must not change the original success criteria.
        }
        // The following is preparation evidence, not a fourth passed case. Only
        // the separately launched method can prove persistence after force-stop.
        Bundle status = new Bundle();
        status.putString("stream", "\nGENIE_DRAFT_PREPARED\n");
        instrumentation.sendStatus(2, status);
    }

    @Test
    public void restoreDraftAfterHostForceStop() throws Exception {
        launch();
        try {
            awaitTrue("location.origin==='https://localhost' && location.pathname==='/' && !!document.querySelector('[aria-label=\"이전 결정 초안\"]')",
                "The persisted draft restore prompt did not appear after force-stop");
        } catch (AssertionError failure) {
            throw new AssertionError(failure.getMessage() + "; draftState=" + draftState("restore", failure), failure);
        }
        assertEquals("Private draft content was shown before explicit restoration", "true", evaluate("(() => {"
            + "const text=document.body.innerText;return !document.getElementById('in-a') && !document.getElementById('in-b')"
            + " && !document.getElementById('in-note') && !text.includes(" + JSONObject.quote(A) + ")"
            + " && !text.includes(" + JSONObject.quote(B) + ") && !text.includes(" + JSONObject.quote(NOTE) + ");})()"));
        assertEquals("Explicit restore button is missing", "true", evaluate("(() => {"
            + "const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='초안 이어쓰기');"
            + "if(!b)return false;b.click();return true;})()"));
        awaitTrue(valuesMatch(), "Explicit restoration did not recover all three exact inputs");
        assertEquals("Restoration unexpectedly left Home", "true", evaluate("location.pathname==='/'"));
        JSONObject evidence = layout();
        evidence.put("explicitRestoreRequired", true).put("exactFieldsRestored", 3);
        report("draft-restore-after-force-stop", evidence);
    }
}
