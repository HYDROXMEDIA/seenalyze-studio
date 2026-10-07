import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { App } from "./App";
import { PreviewEditorRoot } from "./features/PreviewEditorRoot";
import { applyTheme, readTheme } from "./lib/theme";
import { loadMessages } from "./i18n";
import "./styles.css";

applyTheme(readTheme());

// The macOS preview editor window loads this bundle with `#preview-editor`.
const editorOnly = window.location.hash === "#preview-editor";
if (editorOnly) {
  for (const element of [document.documentElement, document.body]) element.style.background = "transparent";
}

const { locale, messages } = loadMessages(navigator.language);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <IntlProvider locale={locale} messages={messages} onError={(error) => console.error(error)}>
      {editorOnly ? <PreviewEditorRoot /> : <App />}
    </IntlProvider>
  </StrictMode>,
);
