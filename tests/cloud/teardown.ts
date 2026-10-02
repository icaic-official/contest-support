import { cleanup, fixture } from "./fixture";
export default async function teardown() {
  await cleanup(fixture());
}
