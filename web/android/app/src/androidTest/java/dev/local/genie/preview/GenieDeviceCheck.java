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
import android.os.SystemClock;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
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
    private Instrumentation instrumentation;
    private MainActivity activity;

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

        assertEquals("About navigation link is missing", "true", evaluate("(() => {"
            + "const a=document.querySelector('a[href=\"/about\"]'); if(!a)return false; a.click(); return true; })()"));
        awaitTrue("location.pathname==='/about' && !!document.querySelector('h2')", "About did not open");
        UiAutomation automation = instrumentation.getUiAutomation();
        assertNotNull("Android system UI automation is unavailable", automation);
        JSONObject beforeBack = awaitNativeBackReady();
        // Exercise the OS Back action once; never invoke the app's dispatcher,
        // WebView.goBack or JavaScript history directly as a passing fallback.
        assertTrue("The Android system rejected the Back action: " + beforeBack,
            automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK));
        try {
            awaitTrue("location.pathname==='/' && !!document.getElementById('in-a')", "Native Android Back did not return Home");
        } catch (AssertionError failure) {
            throw new AssertionError("Native Android Back did not return Home; before=" + beforeBack
                + "; after=" + nativeBackState() + "; path=" + evaluate("location.pathname.slice(0,80)"), failure);
        }
        report("native-back", new JSONObject().put("from", "/about").put("to", "/")
            .put("systemAction", "GLOBAL_ACTION_BACK").put("before", beforeBack));
        report("narrow-screen", layout());

        enter("in-a", A); enter("in-b", B); enter("in-note", NOTE);
        awaitTrue(valuesMatch(), "React did not retain the synthetic input events");
        awaitTrue("(() => { const raw=localStorage.getItem(" + JSONObject.quote(DRAFT_KEY) + ");"
            + "if(!raw)return false;const d=JSON.parse(raw);return d.version===1 && !!d.home && d.home.a==="
            + JSONObject.quote(A) + " && d.home.b===" + JSONObject.quote(B) + " && d.home.note===" + JSONObject.quote(NOTE)
            + " && typeof d.home.revision==='string'; })()", "The real draft autosave did not persist the current form");
        assertFalse("A decision must not have started", "true".equals(evaluate("location.pathname!=='/'")));
        // The following is preparation evidence, not a fourth passed case. Only
        // the separately launched method can prove persistence after force-stop.
        Bundle status = new Bundle();
        status.putString("stream", "\nGENIE_DRAFT_PREPARED\n");
        instrumentation.sendStatus(2, status);
    }

    @Test
    public void restoreDraftAfterHostForceStop() throws Exception {
        launch();
        awaitTrue("location.origin==='https://localhost' && location.pathname==='/' && !!document.querySelector('[aria-label=\"이전 결정 초안\"]')",
            "The persisted draft restore prompt did not appear after force-stop");
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
