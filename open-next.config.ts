import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every SB Ops page is dynamic (session cookie), so no incremental cache is configured.
export default defineCloudflareConfig({});
