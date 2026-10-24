import { shortBuildId } from "@/lib/build";

/** The short commit hash of the running build. The full hash is in the tooltip. */
export function BuildId() {
  return (
    <span title={__BUILD_ID__}>
      Build <code className="font-mono">{shortBuildId(__BUILD_ID__)}</code>
    </span>
  );
}
