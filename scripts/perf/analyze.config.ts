// Prints rendered (pre-minify) bytes per package and source folder:
//   npx vite build -c scripts/perf/analyze.config.ts
import { mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(base, {
  build: { outDir: "/tmp/perf-analyze", emptyOutDir: true },
  plugins: [
    {
      name: "size-report",
      generateBundle(
        _: unknown,
        bundle: Record<string, { type: string; fileName: string; modules?: Record<string, { renderedLength: number }> }>,
      ) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk" || !chunk.modules) continue;
          const sums = new Map<string, number>();
          for (const [id, m] of Object.entries(chunk.modules)) {
            const pkg = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
            const src = id.match(/\/src\/([^/]+(?:\/[^/]+)?)/)?.[1]?.replace(/\.[a-z]+$/, "");
            const key = pkg ?? (src ? `src/${src.split("/")[0]}` : id.slice(-40));
            sums.set(key, (sums.get(key) ?? 0) + m.renderedLength);
          }
          console.log(`\n${chunk.fileName}`);
          for (const [k, v] of [...sums].sort((a, b) => b[1] - a[1]).slice(0, 28)) {
            console.log(`${(v / 1024).toFixed(1).padStart(8)} kB  ${k}`);
          }
        }
      },
    },
  ],
});
