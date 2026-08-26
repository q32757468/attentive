import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/bin.ts"
  },
  format: ["esm"],
  dts: { resolve: ["@attentive-kit/protocol"] },
  noExternal: ["@attentive-kit/protocol"],
  clean: true
});
