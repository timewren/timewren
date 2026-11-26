import { router } from "../../trpc";
import { deviceProcedure } from "./device-procedure";

/** Org'en for token-klienter (web's organization-router). */
export const extOrgRouter = router({
  /**
   * Medlemmer af kaldets org (`userId`, `name`, `email`, `image`, `role`),
   * fx til tildeling af opgaver. Tom uden org.
   */
  members: deviceProcedure.query(({ ctx }) =>
    ctx.web.organization.getMembers(),
  ),
});
