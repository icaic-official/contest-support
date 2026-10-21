import { expect, test } from "@playwright/test";
import { account, fixture, service } from "./fixture";
import {
  byId,
  choose,
  desktop,
  fitsWidth,
  login,
  openDialog,
  phone,
  signOut,
} from "./ui";

test("hosted staff images upload on a phone, download, respect visibility, and can be removed", async ({ page }) => {
  const state = fixture();
  const volunteer = await account("volunteer");
  const description = `Image verification ${crypto.randomUUID()}`;
  const submitted = await volunteer.rpc("workflow", {
    p_session: state.sessions[0],
    p_request: crypto.randomUUID(),
    p_action: {
      type: "submit", team_id: state.teams[0], category: "Other", description,
    },
  });
  expect(submitted.error).toBeNull();
  await page.setViewportSize(phone);
  await login(page, "volunteer", "organiser-phone");
  const card = byId(page, `issue-card-${submitted.data}`);
  await card.click();
  const png = await page.screenshot();
  const images = page.getByRole("region", { name: /^Images · / });
  const thumbs = images.getByRole("button", { name: /^View image uploaded by / });
  await images.getByRole("button", { name: "Add an image", exact: true }).click();
  const upload = openDialog(page);
  await expect(upload).toHaveAccessibleName("Add an image");
  for (const [visibility, label] of [
    ["internal", /^Staff only/],
    ["public", /^Visible to the team/],
  ] as const) {
    await choose(upload.getByRole("radio", { name: label }));
    await upload.getByLabel("Image file").setInputFiles({
      name: `${visibility}.png`, mimeType: "image/png", buffer: png,
    });
    await upload.getByRole("button", { name: "Add image", exact: true }).click();
    // Hosted function startup and two Storage transfers can exceed five seconds.
    await expect(upload.getByRole("status")).toHaveText("Image added.", { timeout: 30000 });
  }
  await upload.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(upload).toBeHidden();
  await expect(thumbs).toHaveCount(2);
  await page.reload();
  await card.click();
  await expect(thumbs).toHaveCount(2);
  expect(await fitsWidth(page)).toBe(true);

  const rows = await volunteer.from("attachments")
    .select("id,visibility").eq("issue_id", submitted.data);
  expect(rows.error).toBeNull();
  expect(rows.data).toHaveLength(2);
  const internal = rows.data?.find((image) => image.visibility === "internal");
  const visible = rows.data?.find((image) => image.visibility === "public");
  expect(internal).toBeDefined();
  expect(visible).toBeDefined();
  if (!internal || !visible) throw new Error("Missing uploaded fixture images.");
  const contestant = await account("contestant");
  const seen = await contestant.from("attachments").select("id").eq("issue_id", submitted.data);
  expect(seen.error).toBeNull();
  expect(seen.data).toEqual([{ id: visible.id }]);
  const privatePath = `${state.sessions[0]}/${submitted.data}/${internal.id}/original`;
  expect((await contestant.storage.from("issue-attachments").download(privatePath)).error)
    .not.toBeNull();
  const otherTeam = await account("cedar");
  const publicPath = `${state.sessions[0]}/${submitted.data}/${visible.id}/original`;
  expect((await otherTeam.storage.from("issue-attachments").download(publicPath)).error)
    .not.toBeNull();

  // Each thumbnail shows a Staff or Team badge.
  await thumbs.filter({ hasText: "Staff" }).click();
  const preview = openDialog(page);
  await expect(preview).toContainText("Staff only");
  await expect(preview.getByRole("img")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await preview.getByRole("link", { name: "Download image" }).click();
  expect((await downloaded).suggestedFilename()).toBe("internal.png");
  await preview.getByRole("button", { name: "Remove image" }).click();
  await expect(preview).toBeHidden();
  await expect(thumbs).toHaveCount(1);
  await expect(images.getByRole("status")).toHaveText("Image removed.");
  expect((await volunteer.storage.from("issue-attachments").download(privatePath)).error)
    .not.toBeNull();
  // The service role can read stored files regardless of application RLS.
  // This establishes physical deletion, not merely loss of download access.
  expect((await service().storage.from("issue-attachments").download(privatePath)).error)
    .not.toBeNull();

  // The desktop console keeps the open issue and lists the image on its tab.
  await page.setViewportSize(desktop);
  const sheet = openDialog(page);
  await sheet.getByRole("tab", { name: /^Images/ }).click();
  await expect(
    sheet.getByRole("button", { name: /^View image uploaded by / }),
  ).toHaveCount(1);
  await sheet.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(sheet).toBeHidden();
  await signOut(page);
  await login(page, "contestant", "contestant");
  await page
    .getByRole("navigation", { name: "Reports" })
    .getByRole("button")
    .filter({ hasText: description })
    .click();
  const teamImages = page.getByRole("region", { name: /^Images/ });
  const teamThumbs = teamImages.getByRole("button", { name: /^View image uploaded by / });
  await expect(teamThumbs).toHaveCount(1);
  await expect(teamImages.getByLabel("Image file")).toHaveCount(0);
  await teamThumbs.click();
  const teamPreview = openDialog(page);
  await expect(teamPreview.getByRole("img")).toBeVisible();
  await expect(teamPreview.getByRole("button", { name: "Remove image" })).toHaveCount(0);
});

test("removing membership blocks unfinished Storage access and image completion", async () => {
  const state = fixture();
  const volunteer = await account("volunteer");
  const admin = await account("admin");
  const userId = state.accounts.volunteer.id;
  const submitted = await volunteer.rpc("workflow", {
    p_session: state.sessions[0],
    p_request: crypto.randomUUID(),
    p_action: { type: "submit", team_id: state.teams[0], category: "Other", description: `Upload access check ${crypto.randomUUID()}` },
  });
  expect(submitted.error).toBeNull();
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const begun = await volunteer.functions.invoke("attachments", { body: {
    action: "begin", session_id: state.sessions[0], request_id: crypto.randomUUID(),
    issue_id: submitted.data, visibility: "internal", name: "access.png", bytes: image.length,
  } });
  expect(begun.error).toBeNull();
  const paths = begun.data as { id: string; original_path: string; thumbnail_path: string };
  for (const path of [paths.original_path, paths.thumbnail_path]) {
    expect((await volunteer.storage.from("issue-attachments").upload(path, image, { contentType: "image/png" })).error).toBeNull();
  }
  const membership = await service().from("memberships").select("team_id,roles,is_admin")
    .eq("session_id", state.sessions[0]).eq("user_id", userId).single();
  expect(membership.error).toBeNull();
  if (!membership.data) throw new Error("Missing fixture membership.");
  const removed = await admin.rpc("manage_member", { p_session: state.sessions[0], p_user: userId, p_remove: true });
  expect(removed.error).toBeNull();
  try {
    expect((await volunteer.storage.from("issue-attachments").download(paths.original_path)).error).not.toBeNull();
    expect((await volunteer.storage.from("issue-attachments").upload(paths.thumbnail_path, image, { contentType: "image/png", upsert: true })).error).not.toBeNull();
    const finished = await volunteer.functions.invoke("attachments", { body: {
      action: "finish", session_id: state.sessions[0], attachment_id: paths.id,
    } });
    expect(finished.error).not.toBeNull();
    const row = await service().from("attachments").select("status").eq("id", paths.id).single();
    expect(row.error).toBeNull();
    expect(row.data?.status).toBe("pending");
  } finally {
    // Restore only this run's fixture membership for the remaining cloud cases.
    const restored = await admin.rpc("manage_member", {
      p_session: state.sessions[0], p_user: userId,
      p_team: membership.data.team_id, p_roles: membership.data.roles, p_admin: membership.data.is_admin,
    });
    expect(restored.error).toBeNull();
  }
});
