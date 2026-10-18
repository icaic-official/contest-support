import { unlinkSync } from "node:fs";
import { cleanup, fixture } from "./fixture";
export default async function teardown() {
  await cleanup(fixture());
  unlinkSync(process.env.MINSKY_CLOUD_FIXTURE ?? "");
}
