import { readFile, rm } from "node:fs/promises";
import { cleanupTestAccount } from "./cleanup-account";
import { db, test } from "./helpers";

test("fjern den fælles konto efter alle afhængige tests", async () => {
  const authDir = test.info().config.metadata.authDir as string;
  const accountFile = `${authDir}/account`;
  const email = await readFile(accountFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!email) return;
  const client = db();
  try {
    await cleanupTestAccount(client, email);
    await rm(accountFile);
    await rm(`${authDir}/user.json`, { force: true });
  } finally {
    await client.end();
  }
});
