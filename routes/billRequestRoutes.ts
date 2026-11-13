import { Router } from "express";
import { ObjectId } from "mongodb";
import type { Collections } from "../models/collections";

export function createBillRequestRoutes(collections: Collections) {
  const { confirmedCollection, billRequestsCollection, tablesCollection } = collections;
  const router = Router();

  // ==========================================
  // 4. BILL REQUEST WORKFLOW
  // ==========================================

  // POST: Customer submits bill request
  router.post("/api/bill-requests", async (req, res) => {
    try {
      const { guestId, tableNo, sessionId } = req.body;

      if (!guestId) {
        return res.status(400).json({ success: false, message: "Guest ID is required!" });
      }

      const table = (tableNo || "01").toString().padStart(2, "0");
      const session = sessionId || `SES-T${table}-${guestId}`;

      // Check for existing active bill request for this session
      const existingRequest = await billRequestsCollection.findOne({
        sessionId: session,
        status: { $in: ["Requested", "Reviewing", "Bill Generated"] },
      });

      if (existingRequest) {
        return res.status(200).json({
          success: true,
          message: "Bill request already submitted and is in progress.",
          data: existingRequest,
          isDuplicate: true,
        });
      }

      // Fetch customer's orders to compute current total
      const sessionOrders = await confirmedCollection
        .find({
          sessionId: session,
          status: { $ne: "Rejected" },
        })
        .toArray();

      const subtotal = sessionOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const taxAmount = parseFloat((subtotal * 0.05).toFixed(2));
      const grandTotal = parseFloat((subtotal + taxAmount).toFixed(2));

      const newBillRequest = {
        guestId,
        tableNo: table,
        sessionId: session,
        itemCount: sessionOrders.length,
        subtotal,
        taxAmount,
        grandTotal,
        status: "Requested", // Requested -> Reviewing -> Bill Generated -> Paid -> Completed
        requestedAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await billRequestsCollection.insertOne(newBillRequest);

      // Update table status to Bill Requested
      await tablesCollection.updateOne(
        { tableNo: table },
        { $set: { status: "Bill Requested", lastUpdated: new Date() } }
      );

      res.status(201).json({
        success: true,
        message: "Bill request successfully submitted to the manager!",
        data: { ...newBillRequest, _id: result.insertedId },
      });
    } catch (error) {
      console.error("Error creating bill request:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // GET: Fetch active bill request for customer
  router.get("/api/bill-requests/active", async (req, res) => {
    try {
      const guestId = req.query.guestId as string;
      const sessionId = req.query.sessionId as string;

      if (!guestId && !sessionId) {
        return res.status(400).json({ success: false, message: "Guest ID or Session ID required." });
      }

      const filter: any = {};
      if (sessionId) filter.sessionId = sessionId;
      else filter.guestId = guestId;

      const latestRequest = await billRequestsCollection
        .find(filter)
        .sort({ requestedAt: -1 })
        .limit(1)
        .toArray();

      res.status(200).json({
        success: true,
        data: latestRequest.length > 0 ? latestRequest[0] : null,
      });
    } catch (error) {
      console.error("Error fetching active bill request:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // GET: Manager lists all bill requests
  router.get("/api/bill-requests", async (req, res) => {
    try {
      const status = req.query.status as string;
      const filter = status ? { status } : {};

      const requests = await billRequestsCollection
        .find(filter)
        .sort({ requestedAt: -1 })
        .toArray();

      res.status(200).json({ success: true, data: requests });
    } catch (error) {
      console.error("Error fetching bill requests:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // PATCH: Manager updates bill request status
  router.patch("/api/bill-requests/:id/status", async (req, res) => {
    try {
      const id = req.params.id;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid bill request ID." });
      }

      const validStatuses = ["Requested", "Reviewing", "Bill Generated", "Paid", "Completed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid bill request status." });
      }

      const result = await billRequestsCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date() } },
        { returnDocument: "after" }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: "Bill request not found." });
      }

      res.status(200).json({ success: true, message: "Bill request updated.", data: result });
    } catch (error) {
      console.error("Error updating bill request status:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });


  return router;
}
