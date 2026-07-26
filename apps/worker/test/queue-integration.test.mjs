import test from "node:test";
import assert from "node:assert/strict";
import { PgBoss } from "pg-boss";

const enabled = process.env.RUN_QUEUE_INTEGRATION === "1";
const integration = enabled ? test : test.skip;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

integration("an expired lease is recovered once by a replacement worker", async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  const queue = `render-${Date.now()}`;
  const first = await new PgBoss({ connectionString, maintenanceIntervalSeconds: 1 }).start();
  await first.createQueue(queue, { expireInSeconds: 1, retryLimit: 1, retryDelay: 0 });
  const jobId = await first.send(queue, { projectId: "project-1" }, { singletonKey: "project-1:1" });
  assert.ok(jobId);
  let leasedResolve;
  const leased = new Promise((resolve) => { leasedResolve = resolve; });
  await first.work(queue, { pollingIntervalSeconds: .5 }, async () => {
    leasedResolve();
    await new Promise(() => {});
  });
  await leased;
  await first.stop({ graceful: false });

  const replacement = await new PgBoss({ connectionString, maintenanceIntervalSeconds: 1 }).start();
  let completions = 0;
  await replacement.work(queue, { pollingIntervalSeconds: .5 }, async () => {
    completions += 1;
    return { objectKey: "projects/project-1/renders/1.mp4" };
  });
  for (let attempt = 0; attempt < 12 && completions === 0; attempt += 1) await wait(500);
  assert.equal(completions, 1);
  await replacement.stop();
});
