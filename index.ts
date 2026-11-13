import express from "express";
import { connectToDatabase } from "./config/database";
import { configureMiddleware } from "./middlewares/configureMiddleware";
import { getCollections } from "./models/collections";
import { createMenuRoutes } from "./routes/menuRoutes";
import { createOrderRoutes } from "./routes/orderRoutes";
import { createBillRequestRoutes } from "./routes/billRequestRoutes";
import { createInvoiceRoutes } from "./routes/invoiceRoutes";
import { createHistoryRoutes } from "./routes/historyRoutes";
import { createTableRoutes } from "./routes/tableRoutes";
import { ensureTablesInitialized } from "./utils/ensureTablesInitialized";

const app = express();
const PORT = process.env.PORT || 5000;

configureMiddleware(app);

async function startServer() {
  try {
    const db = await connectToDatabase();
    const collections = getCollections(db);

    await ensureTablesInitialized(collections.tablesCollection);

    console.log("Successfully connected to MongoDB!");

    app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "Restaurant QR Digital Menu & Order Management System API is live!",
        timestamp: new Date(),
      });
    });

    app.use(createMenuRoutes(collections));
    app.use(createOrderRoutes(collections));
    app.use(createBillRequestRoutes(collections));
    app.use(createInvoiceRoutes(collections));
    app.use(createHistoryRoutes(collections));
    app.use(createTableRoutes(collections));

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
  }
}

startServer();
