import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: { resolve: ["@attentive-kit/protocol"] },
  noExternal: ["@attentive-kit/protocol"],
  clean: true
});
