(() => {
  "use strict";

  const form = document.querySelector("#analytics-export-form");
  const status = document.querySelector("#analytics-export-status");
  const endpoint = document
    .querySelector('meta[name="analytics-endpoint"]')
    ?.content.trim()
    .replace(/\/$/u, "");

  if (!form || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = new FormData(form).get("token")?.toString().trim();

    if (!endpoint) {
      status.textContent = "The private export endpoint has not been deployed yet.";
      return;
    }
    if (!token) {
      status.textContent = "Enter the private export token.";
      return;
    }

    status.textContent = "Preparing export…";

    try {
      const chunks = [];
      let before = null;
      let page = 1;

      while (true) {
        status.textContent = `Preparing export batch ${page}…`;
        const query = new URLSearchParams({ limit: "5000" });
        if (before) query.set("before", before);

        const response = await fetch(`${endpoint}/export.csv?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "omit",
        });
        if (!response.ok) throw new Error(response.status === 401 ? "The token was not accepted." : "The export could not be prepared.");

        const csv = await response.text();
        if (page === 1) {
          chunks.push(csv);
        } else {
          const firstBreak = csv.indexOf("\r\n");
          if (firstBreak >= 0 && firstBreak < csv.length - 2) chunks.push(csv.slice(firstBreak + 2));
        }

        const nextBefore = response.headers.get("X-Next-Before");
        if (!nextBefore || nextBefore === before) break;
        before = nextBefore;
        page += 1;
      }

      const blob = new Blob([chunks.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `wenli-site-events-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
      status.textContent = "CSV downloaded. The token was not persisted. Delete this local CSV within 30 days.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      form.reset();
    }
  });
})();
