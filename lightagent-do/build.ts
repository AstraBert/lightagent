import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";

await esbuild.build({
  // @ts-ignore this is a valid assignment
  plugins: [...denoPlugins()],
  entryPoints: ["src/index.ts"],
  outfile: "dist/bundle.js",
  bundle: true,
  format: "esm",
  platform: "browser", // no Node builtins available in the Worker isolate anyway,
  external: [],
});
esbuild.stop();
