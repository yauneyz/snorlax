import { createRequire } from "node:module";

// Resolve through electron-builder so pnpm supplies the same signing implementation
// and retry behavior used by its normal macOS signing pass.
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { sign } = builderRequire("app-builder-lib/out/codeSign/macCodeSign.js");

export default async function signMacosApp(options) {
  return sign({
    ...options,
    // Preserve explicitly configured profiles; this Developer ID app otherwise
    // needs no profile and must not scan unrelated files in process.cwd().
    preEmbedProvisioningProfile: Boolean(options.provisioningProfile),
  });
}
