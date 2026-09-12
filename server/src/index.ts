import { createCounterpointServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const server = createCounterpointServer(config);

server.listen(config.port, config.host, () => {
  console.log(`Counterpoint server listening on http://${config.host}:${config.port}`);
});
