import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8085);
const token = process.env.MOODLE_WS_TOKEN ?? "test-token";

const { app } = createApp({ token, dbPath: process.env.DB_PATH || undefined, siteUrl: process.env.SITE_URL });

app.listen(port, () => {
  console.log(`Moodle mock escuchando en http://localhost:${port}`);
  console.log(`  Web service: http://localhost:${port}/webservice/rest/server.php`);
  console.log(`  Panel:       http://localhost:${port}/`);
  console.log(`  Token:       ${token}`);
});
