import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { App } from "./App";
import { applyTheme, readTheme } from "./lib/theme";
import { loadMessages } from "./i18n";
import "./styles.css";

applyTheme(readTheme());

const { locale, messages } = loadMessages(navigator.language);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <IntlProvider locale={locale} messages={messages} onError={(error) => console.error(error)}>
      <App />
    </IntlProvider>
  </StrictMode>,
);
