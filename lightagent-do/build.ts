import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";

await esbuild.build({
  plugins: [...denoPlugins()],
  entryPoints: ["src/index.ts"],
  outfile: "dist/bundle.js",
  bundle: true,
  format: "esm",
  platform: "browser", // no Node builtins available in the Worker isolate anyway,
  external: ["@cle-does-things/llms-sdk"]
});
esbuild.stop();
