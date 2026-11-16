export async function checkCloudResponses(base: string) {
  for (const path of ["/docs", "/llms.txt", "/install.sh"]) {
    const response = await fetch(new URL(path, base), {
      headers: { host: "timetrack.dk" },
      redirect: "manual",
    });
    const body = await response.text();
    const status = path === "/llms.txt" ? 200 : 404;
    if (response.status !== status)
      throw new Error(
        `Cloud host must return ${status} for ${path}, got ${response.status}`,
      );
    if (
      path === "/llms.txt" &&
      (/timewren/i.test(body) || !body.startsWith("# TimeTrack (timetrack.dk)"))
    )
      throw new Error(`Unexpected Cloud content for ${path}`);
  }
}
