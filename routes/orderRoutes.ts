import { Router } from "express";
import { ObjectId } from "mongodb";
import type { Collections } from "../models/collections";

export function createOrderRoutes(collections: Collections) {
  const { confirmedCollection, tablesCollection } = collections;
  const router = Router();

  // ==========================================
  // 2. CUSTOMER ORDERS & LIFECYCLE ROUTES
  // ==========================================

  // POST: Customer confirm selection -> save to 'confirmed-item'
  router.post("/api/confirmed-items", async (req, res) => {
    try {
      const orderData = req.body;

      if (!orderData.guestId) {
        return res.status(400).json({
          success: false,
          message: "Guest ID is required!",
        });
      }

      const unitPrice = parseFloat(orderData.price) || 0;
      const qty = parseInt(orderData.quantity) || 1;
      const totalAmount = parseFloat((unitPrice * qty).toFixed(2));
      const tableNo = (orderData.tableNo || "01").toString().padStart(2, "0");
      const sessionId = orderData.sessionId || `SES-T${tableNo}-${orderData.guestId}`;
      const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

      const confirmedOrder = {
        orderNumber,
        guestId: orderData.guestId,
        tableNo,
        sessionId,
        itemId: orderData.itemId || "",
        name: orderData.name || "Item",
        price: unitPrice,
        quantity: qty,
        totalAmount,
        imageUrl: orderData.imageUrl || "",
        specialInstructions: orderData.specialInstructions || "",
        status: "Pending", // Pending -> Confirmed -> Preparing -> Ready -> Served -> Completed | Rejected
        paymentStatus: "Unpaid", // Unpaid | Paid
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await confirmedCollection.insertOne(confirmedOrder);

      // Update table to Occupied
      await tablesCollection.updateOne(
        { tableNo },
        {
          $set: {
            status: "Occupied",
            currentSessionId: sessionId,
            currentGuestId: orderData.guestId,
            lastUpdated: new Date(),
          },
        },
        { upsert: true }
      );

      res.status(201).json({
        success: true,
        message: "Order successfully confirmed and saved!",
        orderId: result.insertedId,
        orderNumber,
        guestId: orderData.guestId,
        tableNo,
        sessionId,
      });
    } catch (error) {
      console.error("Error saving confirmed item:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });

  // GET: Fetch confirmed orders for customer (by guestId or sessionId)
  router.get("/api/confirmed-items", async (req, res) => {
    try {
      const guestId = req.query.guestId as string;
      const sessionId = req.query.sessionId as string;

      if (!guestId && !sessionId) {
        return res.status(400).json({
          success: false,
          message: "Guest ID or Session ID is required!",
        });
      }

      const filter: any = {};
      if (sessionId) {
        filter.sessionId = sessionId;
      } else if (guestId) {
        filter.guestId = guestId;
      }

      const orders = await confirmedCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error) {
      console.error("Error fetching confirmed items:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });

  // GET: Manager live orders (active orders)
  router.get("/api/manager/confirmed-items", async (req, res) => {
    try {
      const includeAll = req.query.all === "true";
      const filter = includeAll ? {} : { status: { $ne: "Completed" } };

      const orders = await confirmedCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error) {
      console.error("Error fetching manager orders:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });

  // PATCH: Manager updates order status
  // Allowed transitions: Pending -> Confirmed -> Preparing -> Ready -> Served -> Completed | Rejected
  router.patch("/api/confirmed-items/:id/status", async (req, res) => {
    try {
      const id = req.params.id;
      const { status, rejectionReason } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid order ID" });
      }

      const validStatuses = [
        "Pending",
        "Confirmed",
        "Preparing",
        "Cooking", // backwards-compatible alias for Preparing
        "Ready",
        "Served",
        "Completed",
        "Rejected",
      ];

      // Standardize alias
      const targetStatus = status === "Cooking" ? "Preparing" : status;

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const updateDoc: any = {
        status: targetStatus,
        updatedAt: new Date(),
      };

      if (targetStatus === "Rejected" && rejectionReason) {
        updateDoc.rejectionReason = rejectionReason;
      }

      const result = await confirmedCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateDoc },
        { returnDocument: "after" }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      // Check if table status needs update based on order state
      const tableNo = result.tableNo;
      if (tableNo) {
        if (targetStatus === "Preparing") {
          await tablesCollection.updateOne({ tableNo }, { $set: { status: "Cooking" } });
        }
      }

      res.status(200).json({
        success: true,
        message: `Order status updated to ${targetStatus}!`,
        order: result,
      });
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // DELETE: Customer removes unconfirmed item (only allowed if still Pending)
  router.delete("/api/confirmed-items/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const guestId = req.query.guestId as string;

      if (!guestId || guestId.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Guest ID is required!",
        });
      }

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
      }

      const order = await confirmedCollection.findOne({
        _id: new ObjectId(id),
        guestId,
      });

      if (!order) {
        return res.status(404).json({ success: false, message: "Order item not found" });
      }

      // Protection: Customer can only cancel Pending orders
      if (order.status !== "Pending") {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel this order because it is already ${order.status.toLowerCase()}. Please speak to a waiter.`,
        });
      }

      await confirmedCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).json({ success: true, message: "Item removed from orders!" });
    } catch (error) {
      console.error("Error deleting confirmed item:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // ==========================================
  // 3. KITCHEN ORDER PROCESSING (KDS)
  // ==========================================

  // GET: Active orders for kitchen display (Confirmed, Preparing, Ready)
  router.get("/api/kitchen/orders", async (req, res) => {
    try {
      const kitchenOrders = await confirmedCollection
        .find({
          status: { $in: ["Confirmed", "Preparing", "Cooking", "Ready"] },
        })
        .sort({ createdAt: 1 }) // oldest first for priority
        .toArray();

      // Standardize any legacy Cooking status
      const standardized = kitchenOrders.map((o) => ({
        ...o,
        status: o.status === "Cooking" ? "Preparing" : o.status,
      }));

      res.status(200).json({ success: true, data: standardized });
    } catch (error) {
      console.error("Error fetching kitchen orders:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });


  return router;
}
