import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { TooltipProvider } from "./components/ui/tooltip";
import { App } from "./App";
import { PreviewEditorRoot } from "./features/PreviewEditorRoot";
import { ProjectorRoot } from "./features/projector/ProjectorRoot";
import { applyTheme, readTheme } from "./lib/theme";
import { initLanguage, useLanguage } from "./lib/language";
import { loadMessages } from "./i18n";
import "./styles.css";

applyTheme(readTheme());
initLanguage();

// The macOS preview editor window loads this bundle with `#preview-editor`.
const editorOnly = window.location.hash === "#preview-editor";
// Projector windows load it with `#projector`.
const projectorOnly = window.location.hash === "#projector";
if (editorOnly) {
  for (const element of [document.documentElement, document.body]) element.style.background = "transparent";
}

function LocalizedRoot() {
  const language = useLanguage();
  const { locale, messages } = loadMessages(language);
  return (
    <IntlProvider locale={locale} messages={messages} onError={(error) => console.error(error)}>
      <TooltipProvider>{editorOnly ? <PreviewEditorRoot /> : projectorOnly ? <ProjectorRoot /> : <App />}</TooltipProvider>
    </IntlProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <LocalizedRoot />
  </StrictMode>,
);
