// Node's type stripper does not add .ts to extensionless imports.
// This hook lets the helper load the repository's TypeScript modules.
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const bare = relative && !/\.[cm]?[jt]s$/.test(specifier) && !specifier.endsWith('.json');
  if (!bare) return nextResolve(specifier, context);
  try {
    return await nextResolve(`${specifier}.ts`, context);
  } catch {
    return nextResolve(specifier, context);
  }
}
