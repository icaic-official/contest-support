/** The independent announcement read, for fixtures that serve only issue data. */
export const emptyAnnouncementSnapshot = () => ({
  announcements: [],
  images: [],
  server_time: new Date().toISOString(),
});
