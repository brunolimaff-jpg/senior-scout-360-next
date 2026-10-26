import { db } from "../src/lib/db";
const batches = await db.importBatch.findMany({ select: { id: true, fileName: true, status: true, rowCount: true } });
console.log(JSON.stringify(batches, null, 1));
await db.$disconnect();
