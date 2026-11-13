import { Router } from "express";
import type { Collections } from "../models/collections";

export function createHistoryRoutes(collections: Collections) {
  const { confirmedCollection } = collections;
  const router = Router();

  // ==========================================
  // 7. COMPLETED ORDERS & HISTORY
  // ==========================================

  // GET: Historical completed orders with filtering
  router.get("/api/manager/completed-orders", async (req, res) => {
    try {
      const { dateFilter = "all", tableNo, search } = req.query;

      const filter: any = {
        status: "Completed",
      };

      if (tableNo) {
        filter.tableNo = (tableNo as string).padStart(2, "0");
      }

      if (search) {
        filter.$or = [
          { orderNumber: { $regex: search as string, $options: "i" } },
          { name: { $regex: search as string, $options: "i" } },
          { guestId: { $regex: search as string, $options: "i" } },
        ];
      }

      if (dateFilter === "today") {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        filter.createdAt = { $gte: startOfToday };
      } else if (dateFilter === "previous") {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        filter.createdAt = { $lt: startOfToday };
      }

      const completedOrders = await confirmedCollection
        .find(filter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .toArray();

      res.status(200).json({
        success: true,
        data: completedOrders,
        count: completedOrders.length,
      });
    } catch (error) {
      console.error("Error fetching completed orders:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });


  return router;
}
