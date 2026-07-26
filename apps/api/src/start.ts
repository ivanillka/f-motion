import { createApp } from "./server.js";

createApp().listen(Number(process.env.PORT ?? 3000));
