import { Router } from "express";
import type { Collections } from "../models/collections";

export function createTableRoutes(collections: Collections) {
  const { tablesCollection, confirmedCollection, invoicesCollection, billRequestsCollection } = collections;
  const router = Router();

  // ==========================================
  // 8. TABLE MANAGEMENT & OVERVIEW STATS
  // ==========================================

  // GET: All restaurant tables with live session summaries
  router.get("/api/tables", async (req, res) => {
    try {
      const tables = await tablesCollection.find({}).sort({ tableNo: 1 }).toArray();

      // Attach live order count for each occupied table
      const enrichedTables = await Promise.all(
        tables.map(async (table) => {
          if (table.currentSessionId) {
            const activeOrders = await confirmedCollection
              .find({
                sessionId: table.currentSessionId,
                status: { $nin: ["Completed", "Rejected"] },
              })
              .toArray();

            const totalActiveAmount = activeOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

            return {
              ...table,
              activeOrderCount: activeOrders.length,
              totalActiveAmount,
            };
          }
          return {
            ...table,
            activeOrderCount: 0,
            totalActiveAmount: 0,
          };
        })
      );

      res.status(200).json({ success: true, data: enrichedTables });
    } catch (error) {
      console.error("Error fetching tables:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // POST: Add a new dining table
  router.post("/api/tables", async (req, res) => {
    try {
      const { tableNo, capacity = 4 } = req.body;
      if (!tableNo) {
        return res.status(400).json({ success: false, message: "Table number is required." });
      }

      const formatted = tableNo.toString().padStart(2, "0");
      const existing = await tablesCollection.findOne({ tableNo: formatted });

      if (existing) {
        return res.status(400).json({ success: false, message: `Table ${formatted} already exists.` });
      }

      const newTable = {
        tableNo: formatted,
        capacity: parseInt(capacity) || 4,
        status: "Available",
        currentSessionId: null,
        currentGuestId: null,
        lastUpdated: new Date(),
      };

      const result = await tablesCollection.insertOne(newTable);
      res.status(201).json({
        success: true,
        message: `Table ${formatted} successfully added!`,
        data: { ...newTable, _id: result.insertedId },
      });
    } catch (error) {
      console.error("Error adding table:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // POST: Quick Bulk Add tables (e.g. Add 5 more tables)
  router.post("/api/tables/bulk-add", async (req, res) => {
    try {
      const count = parseInt(req.body.count) || 5;
      const allTables = await tablesCollection.find({}).toArray();

      // Find max table number
      let maxNo = 0;
      allTables.forEach((t: any) => {
        const parsed = parseInt(t.tableNo, 10);
        if (!isNaN(parsed) && parsed > maxNo) maxNo = parsed;
      });

      const newTables = Array.from({ length: count }, (_, i) => {
        const num = maxNo + i + 1;
        const tableNo = num.toString().padStart(2, "0");
        return {
          tableNo,
          capacity: num % 2 === 0 ? 4 : 2,
          status: "Available",
          currentSessionId: null,
          currentGuestId: null,
          lastUpdated: new Date(),
        };
      });

      await tablesCollection.insertMany(newTables);
      res.status(201).json({
        success: true,
        message: `Successfully created ${count} new tables! (Tables ${newTables[0].tableNo} to ${newTables[newTables.length - 1].tableNo})`,
        data: newTables,
      });
    } catch (error) {
      console.error("Error bulk adding tables:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // PATCH: Manager manual table status update / reset
  router.patch("/api/tables/:tableNo/status", async (req, res) => {
    try {
      const tableNo = req.params.tableNo.padStart(2, "0");
      const { status } = req.body;

      const updateData: any = {
        status,
        lastUpdated: new Date(),
      };

      if (status === "Available") {
        updateData.currentSessionId = null;
        updateData.currentGuestId = null;
      }

      const result = await tablesCollection.updateOne({ tableNo }, { $set: updateData });

      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, message: "Table not found." });
      }

      res.status(200).json({ success: true, message: `Table ${tableNo} status set to ${status}.` });
    } catch (error) {
      console.error("Error updating table status:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // GET: Manager overview statistics
  router.get("/api/manager/stats", async (req, res) => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // 1. Total revenue today from paid invoices
      const todayPaidInvoices = await invoicesCollection
        .find({
          paymentStatus: "Paid",
          paidAt: { $gte: startOfToday },
        })
        .toArray();

      const todayRevenue = todayPaidInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

      // 2. Active orders count
      const activeOrdersCount = await confirmedCollection.countDocuments({
        status: { $in: ["Pending", "Confirmed", "Preparing", "Cooking", "Ready", "Served"] },
      });

      // 3. Occupied tables count
      const occupiedTablesCount = await tablesCollection.countDocuments({
        status: { $ne: "Available" },
      });

      // 4. Pending bill requests count
      const pendingBillsCount = await billRequestsCollection.countDocuments({
        status: { $in: ["Requested", "Reviewing", "Bill Generated"] },
      });

      // 5. Recent 5 orders
      const recentOrders = await confirmedCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      res.status(200).json({
        success: true,
        data: {
          todayRevenue,
          activeOrdersCount,
          occupiedTablesCount,
          pendingBillsCount,
          recentOrders,
        },
      });
    } catch (error) {
      console.error("Error fetching manager stats:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });


  return router;
}
