import openNextWorker from "./.open-next/worker.js";
import { invokeScheduledSalesInventoryScan } from "./cloudflare-sales-scan.mjs";

export {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

const worker = {
  fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    await invokeScheduledSalesInventoryScan(openNextWorker, controller, env, ctx);
  },
};

export default worker;
