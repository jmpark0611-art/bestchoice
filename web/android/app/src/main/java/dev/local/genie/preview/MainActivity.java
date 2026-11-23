package dev.local.genie.preview;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // AndroidX handles both the system Back button and completed Back gestures.
        // Bind to this Activity's lifecycle instead of overriding the legacy back API.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge currentBridge = getBridge();
                WebView webView = currentBridge != null ? currentBridge.getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    // React Router's browser-history entries stay inside the WebView.
                    webView.goBack();
                    return;
                }

                // At the first page, background the task rather than destroy its state.
                // Persistent local drafts cover a later OS process termination.
                moveTaskToBack(true);
            }
        });
    }
}
