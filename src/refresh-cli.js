import { openStore } from "./db/index.js";
import { refreshWorldCupData } from "./refresh.js";

const db = await openStore();

refreshWorldCupData(db)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
