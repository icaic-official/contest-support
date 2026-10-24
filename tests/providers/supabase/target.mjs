// The project no longer operates Supabase. Until the owner deletes it, the
// former shared development project `Minsky` still exists and holds trial
// accounts. Never create or delete test fixtures there.
const retiredDevelopmentProject = 'ovymmobupzowotvrywek';

/** Return the explicit isolated project, or refuse before any client or request starts. */
export function isolatedSupabaseProject(project) {
  if (!/^[a-z]{20}$/.test(project ?? '') || project === retiredDevelopmentProject) {
    throw new Error(
      'Set MINSKY_TEST_PROJECT_REF to an isolated Supabase test project. The former Minsky development project is forbidden.',
    );
  }
  return project;
}
