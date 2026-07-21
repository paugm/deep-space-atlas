import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  // Relative asset URLs so the multi-file dist can be served from a subpath.
  base: "./",
  assetsInclude: ["**/*.glb"],
  plugins: [
    {
      name: "html-app-version",
      transformIndexHtml(html) {
        return html.replaceAll("%APP_VERSION%", version);
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
