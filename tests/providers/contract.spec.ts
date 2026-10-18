import { test } from './fixture';
import { scenarios } from './scenarios';

for (const [name, scenario] of Object.entries(scenarios)) {
  test(name, async ({ provider }) => {
    await scenario(provider);
  });
}
