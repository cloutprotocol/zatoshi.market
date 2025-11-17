import { httpRouter } from "convex/server";
import { gate } from "./gate";

const http = httpRouter();

// Single, signed entrypoint used by the Next.js server
http.route({ path: "/gate", method: "POST", handler: gate });

export default http;

