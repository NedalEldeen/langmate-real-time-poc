import "../bootstrap";
import { app } from "./express-server/app";

const PORT = process.env.SERVER_PORT ?? 3000;

app.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
});
