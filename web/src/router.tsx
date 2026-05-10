import { createBrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { BrowserPage } from "./routes/BrowserPage.tsx";
import { PickerPage } from "./routes/PickerPage.tsx";
import { SessionPage } from "./routes/SessionPage.tsx";
import { SessionTerminal } from "./routes/SessionTerminal.tsx";
import { SessionFiles } from "./routes/SessionFiles.tsx";
import { NotFoundPage } from "./routes/NotFoundPage.tsx";

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: "/", element: <BrowserPage /> },
      { path: "/p/:cwd", element: <PickerPage /> },
      {
        path: "/s/:sessionId",
        element: <SessionPage />,
        children: [
          { index: true, element: <SessionTerminal /> },
          { path: "files", element: <SessionFiles /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
